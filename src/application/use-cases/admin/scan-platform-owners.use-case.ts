import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { CpfLookupService } from '../../../infrastructure/http/cpf-lookup.service';
import {
  PAYMENT_GATEWAY,
  type IPaymentGateway,
} from '../../../core/services/payment-gateway.interface';

/**
 * Mapeia cada tag de tenant para o slug da plataforma correspondente.
 * Sempre que uma nova plataforma começar a usar [CPF_DONO:...] na descrição,
 * basta adicionar aqui.
 */
const TENANT_TO_PLATFORM: Record<string, string> = {
  EBOOK: 'ebook',
  EBOOKSIM: 'ebook',
  RENOVADA: 'renovada',
  REVALIDA: 'revalida',
  BOSQUE: 'bosque',
  PAGATG: 'pagatg',
  FRENDZ: 'frendz',
  ATLAS: 'atlas',
};

// Regex para extrair [TENANT:XXX], [CPF_DONO:YYY], [CNPJ_DONO:ZZZ] e [NOME_DONO:WWW]
const TENANT_REGEX = /\[TENANT:([A-Z0-9_]+)\]/i;
const CPF_DONO_REGEX = /\[CPF_DONO:(\d{11})\]/i;
const CNPJ_DONO_REGEX = /\[CNPJ_DONO:(\d{14})\]/i;
const NOME_DONO_REGEX = /\[NOME_DONO:([^\]]+)\]/i;

function formatDateYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function domCountsTowardOwnerBalance(status: string): boolean {
  const s = (status || '').toLowerCase();
  return (
    s === 'paid' ||
    s === 'completed' ||
    s === 'approved' ||
    s === 'aprovado' ||
    s === 'aprovada'
  );
}

@Injectable()
export class ScanPlatformOwnersUseCase {
  private readonly logger = new Logger(ScanPlatformOwnersUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cpfLookup: CpfLookupService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(): Promise<{
    scanned: number;
    scannedDom: number;
    created: number;
    linked: number;
    walletsUpdated: number;
  }> {
    let created = 0;
    let linked = 0;
    let walletsUpdated = 0;

    const ownerMap = new Map<
      string,
      { document: string; platform: string; totalNet: number; nomeDono: string | null }
    >();

    // ── 1) Transações locais (webhook / interno) com tags na description
    const transactions = await this.prisma.transaction.findMany({
      where: {
        OR: [
          { description: { contains: 'CPF_DONO', mode: 'insensitive' } },
          { description: { contains: 'CNPJ_DONO', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        description: true,
        netAmount: true,
        amount: true,
        status: true,
      },
    });

    const scanned = transactions.length;

    for (const tx of transactions) {
      const desc = tx.description ?? '';
      const cpfMatch = CPF_DONO_REGEX.exec(desc);
      const cnpjMatch = CNPJ_DONO_REGEX.exec(desc);
      const tenantMatch = TENANT_REGEX.exec(desc);

      const document = cpfMatch?.[1] ?? cnpjMatch?.[1] ?? null;
      if (!document || !tenantMatch) continue;

      const tenantTag = tenantMatch[1].toUpperCase();
      const platform = TENANT_TO_PLATFORM[tenantTag];

      if (!platform) continue;

      const nomeDonoMatch = NOME_DONO_REGEX.exec(desc);
      const nomeDono = nomeDonoMatch ? nomeDonoMatch[1].trim() : null;

      const key = `${document}::${platform}`;
      const current = ownerMap.get(key) ?? { document, platform, totalNet: 0, nomeDono: null };

      if (nomeDono && !current.nomeDono) current.nomeDono = nomeDono;

      if (tx.status === 'COMPLETED') {
        current.totalNet += Number(tx.netAmount ?? tx.amount ?? 0);
      }

      ownerMap.set(key, current);
    }

    // Chaves DOM já refletidas no banco com CPF_DONO ou CNPJ_DONO (evita somar 2x com a API)
    const syncedDomKeySet = new Set<string>();
    const domTaggedRows = await this.prisma.transaction.findMany({
      where: {
        OR: [
          { description: { contains: 'CPF_DONO', mode: 'insensitive' } },
          { description: { contains: 'CNPJ_DONO', mode: 'insensitive' } },
        ],
      },
      select: { domPaymentId: true, domTransactionId: true },
    });
    for (const row of domTaggedRows) {
      if (row.domPaymentId) syncedDomKeySet.add(row.domPaymentId);
      if (row.domTransactionId) syncedDomKeySet.add(row.domTransactionId);
    }

    // ── 2) API DOM (product_first / descricao) — mesmas tags, até 24 meses em janelas de 3 meses
    const scannedDom = await this.mergeDomTransactionsIntoOwnerMap(
      ownerMap,
      syncedDomKeySet,
    );

    // ── 3) Subtrair saques aprovados/concluídos do saldo das carteiras externas
    const withdraws = await this.prisma.withdrawRequest.findMany({
      where: { status: { in: ['APPROVED', 'COMPLETED'] } },
      select: { userId: true, grossAmount: true },
    });

    const userWithdrawalMap = new Map<string, number>();
    for (const w of withdraws) {
      userWithdrawalMap.set(w.userId, (userWithdrawalMap.get(w.userId) ?? 0) + Number(w.grossAmount));
    }

    // Processa cada owner encontrado (CPF 11 dígitos ou CNPJ 14 dígitos)
    for (const { document, platform, totalNet, nomeDono } of ownerMap.values()) {
      const isCnpj = document.length === 14;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = isCnpj
          ? await (this.prisma.externalPlatformUser as any).findUnique({
              where: { cnpj_platform: { cnpj: document, platform } },
              include: { wallet: true },
            })
          : await this.prisma.externalPlatformUser.findUnique({
              where: { cpf_platform: { cpf: document, platform } },
              include: { wallet: true },
            });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const simpayUser = isCnpj
          ? await (this.prisma.user as any).findFirst({
              where: { cnpj: document },
              select: { id: true, name: true },
            })
          : await this.prisma.user.findUnique({
              where: { cpf: document },
              select: { id: true, name: true },
            });

        const userWithdrawals = simpayUser ? (userWithdrawalMap.get(simpayUser.id) ?? 0) : 0;
        const finalBalance = Math.max(0, totalNet - userWithdrawals);
        const docLabel = isCnpj ? 'CNPJ' : 'CPF';

        if (existing) {
          const resolvedName = simpayUser?.name?.trim() || nomeDono || null;
          const nameNeedsUpdate = resolvedName && (existing.name.startsWith('CPF ') || existing.name.startsWith('CNPJ '));
          if ((simpayUser && !existing.userId) || nameNeedsUpdate) {
            await this.prisma.externalPlatformUser.update({
              where: { id: existing.id },
              data: {
                ...(simpayUser && !existing.userId ? { userId: simpayUser.id } : {}),
                ...(nameNeedsUpdate ? { name: resolvedName! } : {}),
              },
            });
            if (simpayUser && !existing.userId) linked++;
          }

          if (existing.wallet) {
            await this.prisma.externalPlatformWallet.update({
              where: { externalUserId: existing.id },
              data: { balance: finalBalance },
            });
            walletsUpdated++;
          } else {
            await this.prisma.externalPlatformWallet.create({
              data: { externalUserId: existing.id, balance: finalBalance },
            });
            walletsUpdated++;
          }
        } else {
          // Prioridade: simpayUser > nome da tag [NOME_DONO:] > cpfLookup (só CPF) > fallback
          let name = simpayUser?.name?.trim() || nomeDono || null;
          if (!name && !isCnpj) {
            name = await this.cpfLookup.lookupName(document);
          }
          if (!name) {
            name = `${docLabel} ${document}`;
          }

          const newExtUser = await this.prisma.externalPlatformUser.create({
            data: {
              ...(isCnpj ? { cnpj: document } : { cpf: document }),
              name,
              platform,
              userId: simpayUser?.id ?? null,
            },
          });

          await this.prisma.externalPlatformWallet.create({
            data: { externalUserId: newExtUser.id, balance: finalBalance },
          });

          created++;
          if (simpayUser) linked++;
          walletsUpdated++;
        }
      } catch (err: any) {
        this.logger.error(
          `Erro ao processar owner ${isCnpj ? 'CNPJ' : 'CPF'}=${document} plataforma=${platform}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `ScanPlatformOwners: scannedDb=${scanned} scannedDomRows=${scannedDom} owners=${ownerMap.size} created=${created} linked=${linked} walletsUpdated=${walletsUpdated}`,
    );

    return { scanned, scannedDom, created, linked, walletsUpdated };
  }

  /**
   * Acrescenta ao mapa totais vindos da DOM; ignora transações já representadas no Prisma com CPF_DONO / CNPJ_DONO.
   */
  private async mergeDomTransactionsIntoOwnerMap(
    ownerMap: Map<string, { document: string; platform: string; totalNet: number; nomeDono: string | null }>,
    syncedDomKeySet: Set<string>,
  ): Promise<number> {
    const token =
      process.env.DOM_TOKEN?.trim() || process.env.API_DOM_MASTER_KEY?.trim();
    if (!token) {
      this.logger.warn(
        'ScanPlatformOwners: DOM_TOKEN/API_DOM_MASTER_KEY ausente — pulando varredura na API DOM',
      );
      return 0;
    }

    let domMatched = 0;
    const limit = 150;
    const maxPagesPerWindow = 100;
    const minDate = new Date();
    minDate.setMonth(minDate.getMonth() - 24);

    let windowEnd = new Date();

    for (let w = 0; w < 12; w++) {
      const windowStart = new Date(windowEnd);
      windowStart.setMonth(windowStart.getMonth() - 3);
      if (windowStart < minDate) {
        windowStart.setTime(minDate.getTime());
      }

      const begin_date = formatDateYmd(windowStart);
      const end_date = formatDateYmd(windowEnd);

      if (begin_date > end_date) break;

      for (let page = 1; page <= maxPagesPerWindow; page++) {
        let batch: NonNullable<
          Awaited<
            ReturnType<IPaymentGateway['listDomTransactions']>
          >['transactions']
        > = [];
        try {
          const res = await this.gateway.listDomTransactions(token, {
            page,
            limit,
            begin_date,
            end_date,
          });
          batch = res.transactions ?? [];
        } catch (err: any) {
          this.logger.warn(
            `ScanPlatformOwners DOM janela ${begin_date}..${end_date} página ${page}: ${err?.message ?? err}`,
          );
          break;
        }

        for (const tx of batch) {
          const text = tx.product_first ?? '';
          const cpfMatch = CPF_DONO_REGEX.exec(text);
          const cnpjMatch = CNPJ_DONO_REGEX.exec(text);
          const tenantMatch = TENANT_REGEX.exec(text);

          const document = cpfMatch?.[1] ?? cnpjMatch?.[1] ?? null;
          if (!document || !tenantMatch) continue;

          const tenantTag = tenantMatch[1].toUpperCase();
          const platform = TENANT_TO_PLATFORM[tenantTag];
          if (!platform) continue;

          const keys = [tx.id, tx.order_id, tx.cod_external].filter(
            (k): k is string => typeof k === 'string' && k.length > 0,
          );
          if (keys.some((k) => syncedDomKeySet.has(k))) continue;

          if (!domCountsTowardOwnerBalance(tx.status)) continue;

          const net = Number(tx.liquid_amount ?? tx.amount ?? 0);
          if (!Number.isFinite(net) || net <= 0) continue;

          const nomeDonoMatch = NOME_DONO_REGEX.exec(text);
          const nomeDono = nomeDonoMatch ? nomeDonoMatch[1].trim() : null;

          const key = `${document}::${platform}`;
          const current = ownerMap.get(key) ?? { document, platform, totalNet: 0, nomeDono: null };
          if (nomeDono && !current.nomeDono) current.nomeDono = nomeDono;
          current.totalNet += net;
          ownerMap.set(key, current);
          domMatched++;
        }

        if (batch.length < limit) break;
      }

      windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() - 1);
      if (windowStart.getTime() <= minDate.getTime()) break;
    }

    return domMatched;
  }
}
