import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { calculateSellerNetValue } from '../../helpers/transaction-fee.helper';
import { platformTaxaTagFromText } from '../../helpers/dom-fee-estimate.helper';

@Injectable()
export class SyncDomTransactionsUseCase {
  private readonly logger = new Logger(SyncDomTransactionsUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly prisma: PrismaService,
  ) {}

  private mapStatus(domStatus: string): TransactionStatus {
    switch (domStatus) {
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
    if (!domToken && (user as any).tenantModuleId) {
      const module = await this.prisma.tenantModule.findUnique({
        where: { id: (user as any).tenantModuleId },
      });
      if (module) {
        const envKey = `${module.slug.toUpperCase()}_DOM_TOKEN`;
        domToken = process.env[envKey];
        source = `Módulo (${module.slug})`;
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
            select: { id: true },
          });

          if (existing) {
            await this.prisma.transaction.update({
              where: { id: existing.id },
              data: { status, amount, netAmount, totalFee },
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
}
