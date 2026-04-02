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

// Regex para extrair [TENANT:XXX], [CPF_DONO:YYY] e [NOME_DONO:ZZZ] da descrição
const TENANT_REGEX = /\[TENANT:([A-Z0-9_]+)\]/i;
const CPF_DONO_REGEX = /\[CPF_DONO:(\d{11})\]/i;
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
      { cpf: string; platform: string; totalNet: number; nomeDono: string | null }
    >();

    // ── 1) Transações locais (webhook / interno) com tags na description
    const transactions = await this.prisma.transaction.findMany({
      where: {
        description: { contains: 'CPF_DONO', mode: 'insensitive' },
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
      const tenantMatch = TENANT_REGEX.exec(desc);

      if (!cpfMatch || !tenantMatch) continue;

      const cpf = cpfMatch[1];
      const tenantTag = tenantMatch[1].toUpperCase();
      const platform = TENANT_TO_PLATFORM[tenantTag];

      if (!platform) continue;

      const nomeDonoMatch = NOME_DONO_REGEX.exec(desc);
      const nomeDono = nomeDonoMatch ? nomeDonoMatch[1].trim() : null;

      const key = `${cpf}::${platform}`;
      const current = ownerMap.get(key) ?? { cpf, platform, totalNet: 0, nomeDono: null };

      // Manter o primeiro nome encontrado (ou qualquer nome não-nulo)
      if (nomeDono && !current.nomeDono) current.nomeDono = nomeDono;

      if (tx.status === 'COMPLETED') {
        current.totalNet += Number(tx.netAmount ?? tx.amount ?? 0);
      }

      ownerMap.set(key, current);
    }

    // Chaves DOM já refletidas no banco com CPF_DONO (evita somar 2x com a API)
    const syncedDomKeySet = new Set<string>();
    const domTaggedRows = await this.prisma.transaction.findMany({
      where: {
        description: { contains: 'CPF_DONO', mode: 'insensitive' },
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

    // Processa cada owner encontrado
    for (const { cpf, platform, totalNet, nomeDono } of ownerMap.values()) {
      try {
        const existing = await this.prisma.externalPlatformUser.findUnique({
          where: { cpf_platform: { cpf, platform } },
          include: { wallet: true },
        });

        const simpayUser = await this.prisma.user.findUnique({
          where: { cpf },
          select: { id: true, name: true },
        });

        if (existing) {
          // Atualizar userId e/ou nome se ainda está no fallback
          const resolvedName = simpayUser?.name?.trim() || nomeDono || null;
          const nameNeedsUpdate = resolvedName && existing.name.startsWith('CPF ');
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
              data: { balance: totalNet },
            });
            walletsUpdated++;
          } else {
            await this.prisma.externalPlatformWallet.create({
              data: { externalUserId: existing.id, balance: totalNet },
            });
            walletsUpdated++;
          }
        } else {
          // Prioridade: simpayUser (match por CPF) > nome da tag [NOME_DONO:] > cpfLookup > fallback
          let name = simpayUser?.name?.trim() || nomeDono || null;
          if (!name) {
            name = await this.cpfLookup.lookupName(cpf);
          }
          if (!name) {
            name = `CPF ${cpf}`;
          }

          const newExtUser = await this.prisma.externalPlatformUser.create({
            data: {
              cpf,
              name,
              platform,
              userId: simpayUser?.id ?? null,
            },
          });

          await this.prisma.externalPlatformWallet.create({
            data: { externalUserId: newExtUser.id, balance: totalNet },
          });

          created++;
          if (simpayUser) linked++;
          walletsUpdated++;
        }
      } catch (err: any) {
        this.logger.error(
          `Erro ao processar owner CPF=${cpf} plataforma=${platform}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `ScanPlatformOwners: scannedDb=${scanned} scannedDomRows=${scannedDom} owners=${ownerMap.size} created=${created} linked=${linked} walletsUpdated=${walletsUpdated}`,
    );

    return { scanned, scannedDom, created, linked, walletsUpdated };
  }

  /**
   * Acrescenta ao mapa totais vindos da DOM; ignora transações já representadas no Prisma com CPF_DONO.
   */
  private async mergeDomTransactionsIntoOwnerMap(
    ownerMap: Map<string, { cpf: string; platform: string; totalNet: number; nomeDono: string | null }>,
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
          const tenantMatch = TENANT_REGEX.exec(text);

          if (!cpfMatch || !tenantMatch) continue;

          const cpf = cpfMatch[1];
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

          const key = `${cpf}::${platform}`;
          const current = ownerMap.get(key) ?? { cpf, platform, totalNet: 0, nomeDono: null };
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
