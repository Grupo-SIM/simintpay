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
  }): Promise<{ created: number; updated: number; total: number }> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const domToken = (user as { domToken?: string | null }).domToken;
    if (!domToken)
      throw new BadRequestException(
        'Usuário não possui domToken configurado. Execute o seed primeiro.',
      );

    let page = 1;
    const limit = 50;
    let created = 0;
    let updated = 0;
    let total = 0;

    while (true) {
      const result = await this.gateway.listDomTransactions(domToken, {
        page,
        limit,
      });
      const { transactions } = result;

      if (!transactions.length) break;

      total += transactions.length;
      this.logger.log(
        `Página ${page}: ${transactions.length} transações recebidas`,
      );

      for (const tx of transactions) {
        try {
          const status = this.mapStatus(tx.status);
          const paymentMethod = this.mapPaymentMethod(tx.payment_method);
          const amount = new Prisma.Decimal(tx.amount);
          const rawNet = tx.liquid_amount;
          const netAmount = new Prisma.Decimal(rawNet > 0 ? rawNet : 0);
          const totalFee = amount.sub(netAmount);
          const createdAt = this.parseDate(tx.created_at) ?? new Date();

          const existing = await this.prisma.transaction.findUnique({
            where: { domPaymentId: tx.id },
          });

          if (existing) {
            await this.prisma.transaction.update({
              where: { domPaymentId: tx.id },
              data: { status, netAmount, totalFee },
            });
            updated++;
          } else {
            await this.prisma.transaction.create({
              data: {
                userId: input.userId,
                domPaymentId: tx.id,
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
      }

      if (transactions.length < limit) break;
      page++;
    }

    this.logger.log(
      `Sync concluído: ${created} criadas, ${updated} atualizadas, ${total} total`,
    );
    return { created, updated, total };
  }
}
