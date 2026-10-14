import { getModuleDomToken } from '../../../modules/module.registry';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { DomTransactionItem, IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { calculateSellerNetValue } from '../../helpers/transaction-fee.helper';
import { platformTaxaTagFromText } from '../../helpers/dom-fee-estimate.helper';

function tenantTagFromDomProduct(product: string | null | undefined): string | null {
  const explicitTag = platformTaxaTagFromText(product);
  if (explicitTag !== 'GLOBAL') return explicitTag;

  const text = String(product ?? '').toLowerCase();
  if (text.includes('controle-patrimonial') || text.includes('controle patrimonial')) {
    return 'CONTROLE-PATRIMONIAL';
  }
  if (text.includes('controle-motorista') || text.includes('controle motorista')) {
    return 'CONTROLE-MOTORISTA';
  }
  return null;
}

@Injectable()
export class SyncDomTransactionsUseCase {
  private readonly logger = new Logger(SyncDomTransactionsUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly prisma: PrismaService,
  ) {}

  private mapStatus(domStatus: string): TransactionStatus {
    switch (domStatus.toLowerCase()) {
      case 'paid':
        return TransactionStatus.COMPLETED;
      case 'expired':
        return TransactionStatus.EXPIRED;
      case 'refunded':
        return TransactionStatus.REFUNDED;
      case 'chargeback':
        return TransactionStatus.CHARGEBACK;
      case 'in_mediation':
        return TransactionStatus.IN_MEDIATION;
      case 'pending_refund':
        return TransactionStatus.PENDING_REFUND;
      case 'not_authorized':
      case 'failed':
      case 'error':
        return TransactionStatus.FAILED;
      case 'pending':
        return TransactionStatus.PENDING;
      default:
        return TransactionStatus.PENDING;
    }
  }

  private mapPaymentMethod(method: string): PaymentMethod {
    return method === 'credit_card'
      ? PaymentMethod.CREDIT_CARD
      : PaymentMethod.PIX;
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const d = new Date(value.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }

  async execute(input: {
    userId: string;
    beginDate?: string;
    endDate?: string;
  }): Promise<{ created: number; updated: number; total: number }> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // 1. Prioridade: Token individual do usuário
    let domToken = (user as { domToken?: string | null }).domToken;
    let source = 'Individual';

    // 2. Fallback: Token do Módulo (Revalida, Renovada, etc)
    if (!domToken && (user as any).platformId) {
      const module = await this.prisma.platform.findUnique({
        where: { id: (user as any).platformId },
      });
      if (module) {
        const envKey = `${module.tag.toUpperCase()}_DOM_TOKEN`;
        domToken = getModuleDomToken(module.tag) ?? undefined;
        source = `Módulo (${module.tag})`;
      }
    }

    // 3. Fallback Master (Para o admin principal)
    if (!domToken) {
       domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
       source = 'Master/BFF';
    }

    if (!domToken) {
      throw new BadRequestException(
        'Nenhum Token (Individual, Módulo ou Master) encontrado para sincronização.',
      );
    }

    this.logger.log(`Usando Token ${source} para sincronizar transações...`);

    const limit = 50;
    let created = 0;
    let updated = 0;
    let total = 0;
    const beginDate = input.beginDate ?? '2000-01-01';
    const endDate = input.endDate ?? new Date().toISOString().slice(0, 10);
    const rangeEnd = new Date(`${endDate}T00:00:00.000Z`);
    let rangeStart = new Date(`${beginDate}T00:00:00.000Z`);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeStart > rangeEnd) {
      throw new BadRequestException('Intervalo de replicação inválido');
    }

    // DOM rejects a historical interval before the account's available data with
    // HTTP 500. Start from the most recent period: it imports current failures
    // first and stops only when DOM no longer accepts older history.
    let windowEnd = rangeEnd;
    let completedWindows = 0;
    while (windowEnd >= rangeStart) {
      const windowStartDate = new Date(windowEnd);
      windowStartDate.setUTCMonth(windowStartDate.getUTCMonth() - 3);
      windowStartDate.setUTCDate(windowStartDate.getUTCDate() + 1);
      const windowStart = (windowStartDate < rangeStart ? rangeStart : windowStartDate)
        .toISOString()
        .slice(0, 10);
      const windowEndText = windowEnd.toISOString().slice(0, 10);
      let page = 1;
      let windowReceived = 0;

      try {
        while (true) {
          const result = await this.gateway.listDomTransactions(domToken, {
            page,
            limit,
            begin_date: windowStart,
            end_date: windowEndText,
          });
        const { transactions } = result;

        if (!transactions.length) break;

        total += transactions.length;
        windowReceived += transactions.length;
        this.logger.log(`Janela ${windowStart}–${windowEndText}, página ${page}: ${transactions.length} transações recebidas`);

        for (let index = 0; index < transactions.length; index += 10) {
          const batch = transactions.slice(index, index + 10);
          await Promise.all(batch.map(async (tx) => {
            try {
          const status = this.mapStatus(tx.status);
          const paymentMethod = this.mapPaymentMethod(tx.payment_method);
          const amount = new Prisma.Decimal(tx.amount);
          const tenantTag = platformTaxaTagFromText(tx.product_first ?? undefined);
          const netAmount = calculateSellerNetValue(
            Number(tx.amount),
            Number(tx.installments ?? 1),
            tenantTag,
            tx.payment_method,
          );
          const totalFee = amount.sub(netAmount);
          const createdAt = this.parseDate(tx.created_at) ?? new Date();

          // Busca por domPaymentId OU por domTransactionId para cobrir registros
          // criados com chaves diferentes por versões anteriores do sync
          const domPaymentId = tx.order_id || tx.cod_external || tx.id;
          const existing = await this.prisma.transaction.findFirst({
            where: {
              OR: [
                { domPaymentId },
                ...(tx.id ? [{ domTransactionId: tx.id }] : []),
              ],
            },
            select: { id: true, status: true },
          });

          if (existing) {
            const statusChangedAt = this.parseDate(tx.updated_at) ?? new Date();
            await this.prisma.$transaction(async (p) => {
              await p.transaction.update({
                where: { id: existing.id },
                data: {
                  status,
                  amount,
                  netAmount,
                  totalFee,
                  ...(existing.status !== status
                    ? { previousStatus: existing.status, updatedAt: statusChangedAt }
                    : {}),
                },
              });
              if (existing.status !== status) {
                await p.transactionStatusHistory.create({
                  data: {
                    transactionId: existing.id,
                    fromStatus: existing.status,
                    toStatus: status,
                    metadata: { reason: 'dom-historical-sync' },
                    createdAt: statusChangedAt,
                  },
                });
              }
            });
            updated++;
          } else {
            await this.prisma.transaction.create({
              data: {
                userId: input.userId,
                domTransactionId: tx.id,
                domPaymentId,
                amount,
                netAmount,
                totalFee,
                status,
                paymentMethod,
                installments: tx.installments ?? 1,
                description: tx.product_first ?? null,
                cardBin: tx.card_bin ?? null,
                cardBrand: tx.card_brand ?? null,
                customerName: tx.customer_name ?? null,
                customerEmail: tx.customer_email ?? null,
                customerDocument: tx.customer_document ?? null,
                customerPhone: tx.customer_phone ?? null,
                pixQrCode: tx.pix_qrcode ?? null,
                pixContent: tx.pix_content ?? null,
                pixExpire: this.parseDate(tx.pix_expire),
                createdAt,
              },
            });
            created++;
          }
            } catch (err) {
              this.logger.warn(
                `Erro ao processar transação ${tx.id}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }));
        }

          // DOM currently caps pages at 100 and may ignore a smaller `limit`.
          // `total` falls back to current page size when metadata is absent.
          if (
            transactions.length < limit ||
            windowReceived >= (result.total ?? transactions.length)
          ) break;
          page++;
        }
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 500 && completedWindows > 0) {
          this.logger.warn(
            `DOM recusou histórico anterior a ${windowStart}; importação concluída até ${windowEndText}. Use DOM_REPLICATION_BEGIN_DATE para definir início suportado.`,
          );
          break;
        }
        throw error;
      }

      completedWindows++;
      const previousWindowEnd = new Date(windowStart);
      previousWindowEnd.setUTCDate(previousWindowEnd.getUTCDate() - 1);
      windowEnd = previousWindowEnd;
    }

    this.logger.log(
      `Sync concluído: ${created} criadas, ${updated} atualizadas, ${total} total`,
    );
    return { created, updated, total };
  }

  /**
   * Repara somente o status de réplicas locais já existentes. A rotina não cria
   * transações sem dono local e não altera saldos/carteiras, logo pode ser
   * repetida com segurança para reconciliar histórico importado antes dos
   * webhooks de status.
   */
  async repairHistoricalStatuses(input: {
    beginDate: string;
    endDate: string;
  }): Promise<{ scanned: number; matched: number; updated: number; tagged: number; unchanged: number }> {
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!domToken) throw new BadRequestException('DOM_TOKEN não configurado');

    const begin = dayjs(input.beginDate);
    const end = dayjs(input.endDate);
    if (!begin.isValid() || !end.isValid() || begin.isAfter(end, 'day')) {
      throw new BadRequestException('Intervalo de reparação inválido');
    }

    const domTransactions: DomTransactionItem[] = [];
    const limit = 100;
    for (let page = 1; page <= 400; page += 1) {
      const result = await this.gateway.listDomTransactions(domToken, {
        page,
        limit,
        begin_date: input.beginDate,
        end_date: input.endDate,
      });
      const batch = result.transactions ?? [];
      domTransactions.push(...batch);
      if (batch.length < limit || (typeof result.total === 'number' && page * limit >= result.total)) break;
    }

    const byExternalId = new Map<string, typeof domTransactions[number]>();
    const localIds = new Set<string>();
    for (const transaction of domTransactions) {
      for (const key of [transaction.id, transaction.order_id, transaction.cod_external]) {
        if (!key) continue;
        byExternalId.set(key, transaction);
        localIds.add(key);
      }
    }

    let matched = 0;
    let updated = 0;
    let tagged = 0;
    let unchanged = 0;
    const ids = [...localIds];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      const localTransactions = await this.prisma.transaction.findMany({
        where: {
          OR: [
            { id: { in: chunk } },
            { domPaymentId: { in: chunk } },
            { domTransactionId: { in: chunk } },
          ],
        },
        select: { id: true, status: true, description: true, domPaymentId: true, domTransactionId: true },
      });

      for (const local of localTransactions) {
        const domTransaction = [local.domPaymentId, local.domTransactionId, local.id]
          .map((key) => key ? byExternalId.get(key) : undefined)
          .find(Boolean);
        if (!domTransaction) continue;
        matched++;

        const tenantTag = tenantTagFromDomProduct(domTransaction.product_first);
        const description = tenantTag && !local.description?.includes(`[TENANT:${tenantTag}]`)
          ? `[TENANT:${tenantTag}] ${domTransaction.product_first ?? local.description ?? ''}`.trim()
          : undefined;
        const nextStatus = this.mapStatus(domTransaction.status);
        const statusChanged = local.status !== nextStatus;
        if (!statusChanged && !description) {
          unchanged++;
          continue;
        }

        const statusChangedAt = this.parseDate(domTransaction.updated_at) ?? new Date();
        await this.prisma.$transaction(async (p) => {
          await p.transaction.update({
            where: { id: local.id },
            data: {
              ...(statusChanged
                ? {
                    status: nextStatus,
                    previousStatus: local.status,
                    updatedAt: statusChangedAt,
                  }
                : {}),
              ...(description ? { description } : {}),
            },
          });
          if (statusChanged) {
            await p.transactionStatusHistory.create({
              data: {
                transactionId: local.id,
                fromStatus: local.status,
                toStatus: nextStatus,
                metadata: { reason: 'dom-historical-status-repair' },
                createdAt: statusChangedAt,
              },
            });
          }
        });
        if (statusChanged) updated++;
        if (description) tagged++;
      }
    }

    this.logger.log(
      `Reparação DOM ${input.beginDate}–${input.endDate}: ${updated} status atualizados de ${matched} réplicas locais.`,
    );
    return { scanned: domTransactions.length, matched, updated, tagged, unchanged };
  }
}
