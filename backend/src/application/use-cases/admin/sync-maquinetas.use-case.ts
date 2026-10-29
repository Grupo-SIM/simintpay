import {
  loadChargePolicy,
  quoteReportedPos,
} from '../../../modules/financial-policy/financial-charge';
import { isPhysicalDebit } from '../../helpers/dom-fee-estimate.helper';
import {
  registeredPlatformTags,
  getPlatformOwnerId,
} from '../../../modules/module.registry';
import { getPlatformIntegrationValue } from '../../../modules/platform-integrations/platform-integrations.store';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TransactionStatus, PaymentMethod } from '@prisma/client';
import dayjs from 'dayjs';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  appendInternalTags,
  ORIGEM_MAQUINETA_TAG,
} from '../../utils/internal-tags.util';
import { calculateMaquinetaFees } from '../../helpers/maquineta-fee.helper';

/**
 * Plataformas que operam maquineta (POS). As taxas saem da aba /admin/taxas
 * resolvidas por `tag` (POS_TAXA_*_PERCENT da Sim Int Pay e POS_MDR_* da DOM).
 *
 * Para ligar uma plataforma nova: adicione uma entrada aqui com o CNPJ usado nas
 * vendas físicas e/ou os seriais dos terminais. Nada mais precisa mudar.
 */
type MaquinetaPlatform = {
  /** Tag de taxas / plataforma (RENOVADA, BOSQUE, …). */
  tag: string;
  /** Tag interna gravada na descrição da transação. */
  tenantTag: string;
  /** Variável de ambiente com o userId dono da carteira. */
  /** CNPJ(s) que a DOM envia em `customer_document` nas vendas físicas. */
  documents: string[];
  /** Seriais dos terminais cadastrados. */
  serials: string[];
  /** Recebe as transações POS genéricas (sem CNPJ/serial reconhecível). */
  isDefault?: boolean;
  /** Serial usado quando a DOM não informa nenhum. */
  fallbackSerial: string;
};

function configuredMachinePlatforms(): MaquinetaPlatform[] {
  return registeredPlatformTags().flatMap((tag) => {
    const serials = (getPlatformIntegrationValue(tag, 'MACHINE_SERIALS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!serials.length) return [];
    return [
      {
        tag,
        tenantTag: `[TENANT:${tag}]`,
        documents: (getPlatformIntegrationValue(tag, 'MACHINE_DOCUMENTS') ?? '')
          .split(',')
          .filter(Boolean),
        serials,
        isDefault: false,
        fallbackSerial: `POS-${tag}`,
      },
    ];
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class SyncMaquinetasUseCase {
  private readonly logger = new Logger(SyncMaquinetasUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
  ) {}

  async execute(daysBack?: number): Promise<{
    synced: number;
    skipped: number;
    errors: number;
    totalAmount: number;
    message: string;
  }> {
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!domToken) {
      throw new Error('DOM_TOKEN não configurado no .env');
    }

    // Carteira de cada plataforma com maquineta — sem carteira, a plataforma é ignorada.
    const platformsComCarteira: Array<{
      platform: MaquinetaPlatform;
      userId: string;
    }> = [];
    for (const platform of configuredMachinePlatforms()) {
      const userId = getPlatformOwnerId(platform.tag);
      if (!userId) continue;
      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        this.logger.warn(
          `[SyncMaquinetas] Wallet de ${platform.tag} não encontrada — plataforma ignorada`,
        );
        continue;
      }
      platformsComCarteira.push({ platform, userId });
    }
    if (platformsComCarteira.length === 0) {
      throw new Error(
        'Nenhuma plataforma com maquineta possui carteira configurada',
      );
    }

    const allMachineTxs = await this.fetchAllMachineTxsFromDom(
      domToken,
      platformsComCarteira.map((p) => p.platform),
      daysBack,
    );
    this.logger.log(
      `[SyncMaquinetas] Encontradas ${allMachineTxs.length} transações de maquinetas na DOM`,
    );

    let synced = 0;
    let skipped = 0;
    let errors = 0;
    let totalAmount = 0;

    for (const { tx, platform } of allMachineTxs) {
      const userId = platformsComCarteira.find(
        (p) => p.platform.tag === platform.tag,
      )!.userId;
      try {
        const amountReais = tx.amount; // DOM envia em Reais (ex: 25.00) para máquinas
        const serial = tx.serial;
        let fees = calculateMaquinetaFees(
          platform.tag,
          amountReais,
          tx.payment_method,
          tx.installments,
          tx.card_brand,
        );

        // Verificar se já existe no banco (pela domPaymentId que é UNICA)
        const existing = await this.prisma.transaction.findUnique({
          where: { domPaymentId: tx.id },
        });

        if (existing) {
          const oldAmount = existing.amount.toNumber();
          const diff = amountReais - oldAmount;
          const hasMissingFields =
            !existing.customerDocument ||
            !existing.domTransactionId ||
            !(existing as any).cardCodeAuth;

          // SEM RETROATIVIDADE: transação já sincronizada nunca é reprecificada com as
          // taxas novas. Se o bruto está correto, o netAmount e a carteira não são tocados.
          if (Math.abs(diff) < 0.001) {
            if (hasMissingFields) {
              await this.prisma.transaction.update({
                where: { id: existing.id },
                data: {
                  // Só atualiza domTransactionId se ainda não está preenchido (evita unique constraint)
                  ...(!existing.domTransactionId && tx.cod_external
                    ? { domTransactionId: tx.cod_external }
                    : {}),
                  customerEmail: tx.customer_email,
                  customerDocument: tx.customer_document,
                  customerPhone: tx.customer_phone,
                  cardBrand: tx.card_brand,
                  cardBin: tx.card_bin,
                  cardCodeAuth: tx.card_code_auth,
                },
              });
              synced++;
              continue;
            }
            skipped++;
            continue;
          }

          // Bruto errado (ex: 0.25 vs 25.00): corrige o valor mantendo a TAXA ANTIGA —
          // o líquido é escalado na mesma proporção do bruto, nunca recalculado com as
          // taxas novas. Só o custo DOM é reestimado (não afeta o cliente nem a carteira).
          const oldNet = existing.netAmount?.toNumber() ?? null;
          const ratio =
            oldAmount !== 0 && oldNet !== null ? amountReais / oldAmount : null;
          const netCorrigido =
            ratio !== null ? round2(oldNet! * ratio) : fees.netAmount;
          const platformFeeCorrigido = round2(amountReais - netCorrigido);
          const domFeeCorrigido = fees.domFeeAmt;

          this.logger.log(
            `[SyncMaquinetas] Corrigindo transação ${tx.id}: R$${oldAmount} -> R$${amountReais} (Dif: R$${diff.toFixed(2)})`,
          );

          await this.prisma.$transaction(async (p) => {
            // 1. Atualizar a transação
            await p.transaction.update({
              where: { id: existing.id },
              data: {
                amount: new Prisma.Decimal(amountReais),
                netAmount: new Prisma.Decimal(netCorrigido),
                totalFee: new Prisma.Decimal(
                  domFeeCorrigido + platformFeeCorrigido,
                ),
                domFee: new Prisma.Decimal(domFeeCorrigido),
                platformFee: new Prisma.Decimal(platformFeeCorrigido),
                description: appendInternalTags(
                  `Maquineta (CORRIGIDA) - Terminal: ${serial}`,
                  [platform.tenantTag, ORIGEM_MAQUINETA_TAG],
                ),
                domTransactionId: tx.cod_external || null,
                customerEmail: tx.customer_email,
                customerDocument: tx.customer_document,
                customerPhone: tx.customer_phone,
              },
            });

            // 2. Ajustar saldo da carteira com a DIFERENÇA de líquido.
            // wallet.balance acumula o netAmount; oldNet é o que foi creditado na última sync.
            const currentWallet = await p.wallet.findUnique({
              where: { userId },
            });
            if (currentWallet) {
              const baseNet = oldNet ?? netCorrigido;
              const diffNet = netCorrigido - baseNet;
              const newBalance = currentWallet.balance.add(
                new Prisma.Decimal(diffNet),
              );
              await p.wallet.updateMany({
                where: { id: currentWallet.id, version: currentWallet.version },
                data: { balance: newBalance, version: { increment: 1 } },
              });

              await p.balanceLog.create({
                data: {
                  userId,
                  action: 'MAQUINETA_CORRECTION',
                  transactionId: existing.id,

                  balanceDelta: new Prisma.Decimal(newBalance).sub(
                    currentWallet.balance,
                  ),

                  lockedDelta: 0,

                  source: 'MAQUINETA_SYNC',
                  description: `Ajuste net: R$${baseNet.toFixed(2)} -> R$${netCorrigido.toFixed(2)} (diff: R$${diffNet.toFixed(2)})`,
                },
              });
            }
          });

          synced++;
          totalAmount += diff;
          continue;
        }

        const financialQuote = tx.created_at
          ? quoteReportedPos(
              await loadChargePolicy(
                this.prisma,
                platform.tag,
                new Date(tx.created_at),
              ),
              amountReais,
              isPhysicalDebit(tx.payment_method, tx.card_brand)
                ? 'DEBIT_CARD'
                : /card|credit/i.test(tx.payment_method ?? '')
                  ? 'CREDIT_CARD'
                  : 'PIX',
              Number(tx.installments ?? 1),
            )
          : null;
        if (financialQuote)
          fees = {
            simIntRate: 0,
            platformFeeAmt: financialQuote.platformProfit,
            netAmount: financialQuote.netAmount,
            domFeeAmt: financialQuote.domFeeAmount,
          };
        // --- NOVA TRANSAÇÃO ---
        const pm = String(tx.payment_method ?? '').toLowerCase();
        // TODO: mudar CREDIT_CARD para DEBIT_CARD quando rodar: prisma migrate dev + prisma generate
        const paymentMethod =
          pm.includes('card') || pm.includes('debit') || pm.includes('credit')
            ? PaymentMethod.CREDIT_CARD
            : PaymentMethod.PIX;

        await this.prisma.$transaction(async (p) => {
          const newTx = await p.transaction.create({
            data: {
              userId,
              domPaymentId: tx.id,
              ...(financialQuote
                ? {
                    financialSnapshot: financialQuote.financialSnapshot,
                    settlementBasis: 'FINAL_NET' as const,
                  }
                : {}),
              domTransactionId: tx.cod_external || null, // null para PIX sem cod_external
              amount: new Prisma.Decimal(amountReais),
              // Cliente só perde a taxa Sim Int Pay — o MDR da DOM sai da margem da casa.
              netAmount: new Prisma.Decimal(fees.netAmount),
              totalFee: new Prisma.Decimal(
                fees.domFeeAmt + fees.platformFeeAmt,
              ),
              domFee: new Prisma.Decimal(fees.domFeeAmt),
              platformFee: new Prisma.Decimal(fees.platformFeeAmt),
              status: TransactionStatus.COMPLETED,
              paymentMethod,
              description: appendInternalTags(
                `Maquineta - Terminal: ${serial}`,
                [platform.tenantTag, ORIGEM_MAQUINETA_TAG],
              ),
              installments: Number(tx.installments ?? 1),
              customerName: tx.customer_name ?? 'Cliente POS',
              customerEmail: tx.customer_email ?? '',
              customerDocument: tx.customer_document ?? '',
              customerPhone: tx.customer_phone ?? '',
              cardBrand: tx.card_brand ?? null,
              cardBin: tx.card_bin ?? null,
              cardCodeAuth: tx.card_code_auth ?? null,
              createdAt: tx.created_at ? new Date(tx.created_at) : new Date(),
            },
          });

          await p.transactionStatusHistory.create({
            data: {
              transactionId: newTx.id,
              fromStatus: TransactionStatus.DRAFT,
              toStatus: TransactionStatus.COMPLETED,
              metadata: {
                reason: 'sync-maquinetas',
                serial,
                plataforma: platform.tag,
              },
            },
          });

          // wallet.balance armazena o líquido do cliente = amount × (1 − taxa Sim Int Pay)
          const currentWallet = await p.wallet.findUnique({
            where: { userId },
          });
          if (currentWallet) {
            const newBalance = currentWallet.balance.add(
              new Prisma.Decimal(fees.netAmount),
            );
            await p.wallet.updateMany({
              where: { id: currentWallet.id, version: currentWallet.version },
              data: { balance: newBalance, version: { increment: 1 } },
            });
            await p.balanceLog.create({
              data: {
                userId,
                action: 'MAQUINETA_SYNC',
                transactionId: newTx.id,

                balanceDelta: new Prisma.Decimal(newBalance).sub(
                  currentWallet.balance,
                ),

                lockedDelta: 0,

                source: 'MAQUINETA_SYNC',
                description: `Terminal: ${serial}`,
              },
            });
          }
        });

        synced++;
        totalAmount += amountReais;
        this.logger.log(
          `[SyncMaquinetas] Sincronizada: domId=${tx.id}, plataforma=${platform.tag}, serial=${serial}, ` +
            `valor=R$${amountReais.toFixed(2)}, taxa=${(fees.simIntRate * 100).toFixed(2)}%, ` +
            `líquido=R$${fees.netAmount.toFixed(2)}, custoDOM=R$${fees.domFeeAmt.toFixed(2)}`,
        );
      } catch (err: any) {
        if (err?.code === 'P2002') {
          skipped++;
        } else {
          errors++;
          this.logger.error(
            `[SyncMaquinetas] Erro ao sincronizar ${tx.id}: ${err.message}`,
          );
        }
      }
    }

    const message = `Sincronização concluída: ${synced} novas, ${skipped} já existentes, ${errors} erros. Total: R$${totalAmount.toFixed(2)}`;
    this.logger.log(`[SyncMaquinetas] ${message}`);

    return { synced, skipped, errors, totalAmount, message };
  }

  /** Busca transações pagas de maquinetas diretamente da DOM Pagamentos.
   * @param daysBack - Se informado, limita a busca aos últimos N dias (para uso no cron).
   *                   Se omitido, usa MAQUINETA_SYNC_BEGIN_DATE ou 30 dias (sync completo). */
  private async fetchAllMachineTxsFromDom(
    domToken: string,
    platforms: MaquinetaPlatform[],
    daysBack?: number,
  ): Promise<Array<{ tx: any; platform: MaquinetaPlatform }>> {
    const baseUrl = (
      process.env.DOM_REAL_API_URL ??
      'https://apiv3.dompagamentos.com.br/checkout/production'
    ).replace(/\/$/, '');
    const url = `${baseUrl}/transactions`;

    let beginDate: string;
    if (daysBack) {
      beginDate = dayjs().subtract(daysBack, 'day').format('YYYY-MM-DD');
    } else {
      // Forçar 30 dias se não houver data no env, ou se a data do env for muito antiga (2024, etc)
      const envDate = process.env.MAQUINETA_SYNC_BEGIN_DATE;
      beginDate =
        envDate && !envDate.startsWith('2024')
          ? envDate
          : dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    }

    const endDate = dayjs().format('YYYY-MM-DD');

    this.logger.log(
      `[SyncMaquinetas] Rodando busca na DOM: ${beginDate} até ${endDate} (URL: ${url})`,
    );

    const headers = {
      Authorization: `Bearer ${domToken}`,
      'x-access-token': domToken,
      Accept: 'application/json',
    };

    const allTxs: Array<{ tx: any; platform: MaquinetaPlatform }> = [];
    let page = 1;
    const limit = 50; // Reduzido para 50 para evitar sobrecarga no master token

    while (true) {
      try {
        const params = {
          page,
          limit,
          begin_date: beginDate,
          end_date: endDate,
        };

        this.logger.debug(
          `[SyncMaquinetas] GET Page ${page} Params: ${JSON.stringify(params)}`,
        );

        const res = await firstValueFrom(
          this.http.get<any>(url, {
            headers,
            params,
          }),
        );

        const root = res.data;
        const items =
          root?.transactions || root?.data || (Array.isArray(root) ? root : []);

        if (!items || items.length === 0) {
          this.logger.log(`[SyncMaquinetas] Página ${page} sem itens.`);
          break;
        }

        this.logger.log(
          `[SyncMaquinetas] Página ${page}: Recebidos ${items.length} itens brutos.`,
        );

        // Filtrar apenas transações de maquinetas e atribuir à plataforma dona
        let machineCountInPage = 0;
        for (const item of items) {
          const s = String(item.status ?? '').toLowerCase();
          const isSuccessful =
            s === 'paid' || s === 'approved' || s === 'completed';
          if (!isSuccessful) continue;

          const platform = this.matchMachinePlatform(item, platforms);
          if (!platform) continue;

          allTxs.push({ tx: this.normalizeTx(item, platform), platform });
          machineCountInPage++;
        }

        this.logger.log(
          `[SyncMaquinetas] Página ${page}: ${machineCountInPage} identificados como máquina (pagas/aprovadas).`,
        );

        if (items.length < limit) break;

        const total = root?.total ?? root?.total_results ?? null;
        if (total !== null && allTxs.length >= total) break;

        page++;
        if (page > 50) {
          this.logger.warn('[SyncMaquinetas] Limite de 50 páginas atingido');
          break;
        }
      } catch (err: any) {
        this.logger.error(
          `[SyncMaquinetas] Erro na página ${page}: ${err?.response?.status ?? err.message}`,
        );
        if (err?.response?.data) {
          this.logger.error(
            `[SyncMaquinetas] Detalhes do erro: ${JSON.stringify(err.response.data)}`,
          );
        }
        break;
      }
    }

    return allTxs;
  }

  /**
   * Identifica se uma transação da DOM é de maquineta (POS) e de qual plataforma.
   * Retorna null quando não é venda física de nenhuma plataforma configurada.
   */
  private matchMachinePlatform(
    item: any,
    platforms: MaquinetaPlatform[],
  ): MaquinetaPlatform | null {
    const typeOp = String(item.type_operation ?? '').toLowerCase();
    const doc = String(
      item.customer_document ?? item.customer?.document ?? '',
    ).replace(/\D/g, '');
    const email = String(
      item.customer_email ?? item.customer?.email ?? '',
    ).toLowerCase();
    const serial = String(
      item.serial_number ?? item.terminal_serial ?? '',
    ).toUpperCase();
    const name = String(
      item.customer?.name ?? item.customer_name ?? '',
    ).toUpperCase();

    // 1. Prioridade: operação física + CNPJ da plataforma
    // (Para PIX via POS, customer_document pode ser o CPF do pagador — não o CNPJ da plataforma)
    if (typeOp === 'fisical') {
      const byDoc = platforms.find((p) => p.documents.includes(doc));
      if (byDoc) return byDoc;
    }

    // 2. Serial cadastrado na plataforma
    if (serial && serial !== 'SEM-SERIAL') {
      const bySerial = platforms.find((p) => p.serials.includes(serial));
      if (bySerial) return bySerial;
    }

    // 3. POS genérico (email de maquininha ou nome padrão do terminal) → plataforma default
    const isGenericPos =
      (typeOp === 'fisical' && email.includes('maquininha')) ||
      name === 'CLIENTE POS' ||
      name === 'PAYWAVE/VISA';
    if (isGenericPos) {
      return platforms.find((p) => p.isDefault) ?? null;
    }

    return null;
  }

  private extractSerial(item: any, platform: MaquinetaPlatform): string {
    const serial = String(
      item.serial_number ?? item.terminal_serial ?? '',
    ).toUpperCase();
    if (serial && serial !== 'SEM-SERIAL') return serial;

    const name = String(
      item.customer?.name ?? item.customer_name ?? '',
    ).toUpperCase();
    const m = name.match(/Terminal:\s*([A-Z0-9]+)/i);
    if (m) return m[1];

    return platform.fallbackSerial;
  }

  private normalizeTx(item: any, platform: MaquinetaPlatform): any {
    // A DOM traz amount em valor real (ex: 25.00), mas salvamos bruto
    const amountRaw = Number(item.amount ?? 0);
    const liquidRaw = Number(item.liquid_amount ?? 0);

    return {
      id: item.id ?? item.order_id,
      created_at: item.created_at ?? item.createdAt,
      updated_at: item.updated_at ?? item.updatedAt ?? item.created_at,
      amount: amountRaw,
      // Líquido informado pela DOM (bruto − MDR). Guardado só como referência:
      // o líquido do cliente é calculado pela taxa Sim Int Pay, não por este campo.
      liquid_amount: liquidRaw,
      status: item.status ?? 'paid',
      status_details: item.status_details ?? 'Aprovado',
      payment_method: item.payment_method ?? 'credit_card',
      installments: item.installments ?? 1,
      card_brand: item.card_brand ?? null,
      card_bin: item.card_bin ?? null,
      card_code_auth: item.card_code_auth ?? null,
      customer_name: item.customer?.name ?? item.customer_name ?? 'Cliente POS',
      customer_email: item.customer?.email ?? item.customer_email ?? '',
      customer_document:
        item.customer?.document ??
        item.customer_document ??
        platform.documents[0] ??
        '',
      customer_phone: item.customer?.mobile_phone ?? item.customer_phone ?? '',
      // Para PIX via POS, cod_external é null — usa o E2E ID (card_code_auth) como referência única
      // Nunca usar '' como fallback: string vazia viola o unique constraint de domTransactionId
      cod_external:
        item.cod_external ||
        item.external_id ||
        item.nsu ||
        item.card_code_auth ||
        null,
      type_operation: item.type_operation ?? 'fisical',
      serial: this.extractSerial(item, platform),
    };
  }
}
