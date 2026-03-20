import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY, type IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class GetTransactionDetailsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  private mapStatusToLabel(status: TransactionStatus): string {
    switch (status) {
      case TransactionStatus.COMPLETED: return 'Aprovado';
      case TransactionStatus.REFUNDED: return 'Estornado';
      case TransactionStatus.CHARGEBACK: return 'Chargeback';
      case TransactionStatus.FAILED: return 'Recusado';
      case TransactionStatus.EXPIRED: return 'Expirado';
      case TransactionStatus.IN_MEDIATION: return 'Em mediação';
      case TransactionStatus.PENDING_REFUND: return 'Estorno pendente';
      case TransactionStatus.PENDING: return 'Pendente';
      default: return 'Rascunho';
    }
  }

  private mapStatusToType(status: TransactionStatus): string {
    switch (status) {
      case TransactionStatus.COMPLETED: return 'approved';
      case TransactionStatus.REFUNDED: return 'refunded';
      case TransactionStatus.CHARGEBACK: return 'chargeback';
      case TransactionStatus.FAILED: return 'failed';
      case TransactionStatus.EXPIRED: return 'expired';
      case TransactionStatus.PENDING: return 'pending';
      default: return 'draft';
    }
  }

  /** Format a UTC Date as BRT (UTC-3) string "YYYY-MM-DD HH:MM:SS" */
  private toBRT(date: Date): string {
    const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000);
    return brt.toISOString().replace('T', ' ').slice(0, 19);
  }

  private buildFallbackOrder(tx: any): object {
    const amount = Number(tx.amount ?? 0);
    const netAmount = Number(tx.netAmount ?? 0);
    // Prefer stored totalFee; calculate from amount-netAmount as fallback
    const totalFee = Number(tx.totalFee ?? 0) || Math.max(0, amount - netAmount);
    const domFee = Number(tx.domFee ?? 0);

    const historicStatus = tx.statusHistory?.length
      ? tx.statusHistory.map((h: any) => ({
          status: this.mapStatusToLabel(h.toStatus),
          type: this.mapStatusToType(h.toStatus),
          date: this.toBRT(h.createdAt),
          color: h.toStatus === TransactionStatus.COMPLETED ? '#40a083' : '#3fa0e5',
        }))
      : [
          {
            status: 'Pendente',
            type: 'pending',
            date: this.toBRT(tx.createdAt),
            color: '#3fa0e5',
          },
          ...(tx.status === TransactionStatus.COMPLETED
            ? [{
                status: 'Aprovado',
                type: 'approved',
                date: this.toBRT(tx.updatedAt),
                color: '#40a083',
              }]
            : []),
        ];

    return {
      order_id: tx.domPaymentId ?? tx.id,
      id_transaction: tx.domTransactionId ?? tx.id,
      type: this.mapStatusToType(tx.status),
      type_payment: tx.paymentMethod === 'CREDIT_CARD' ? 'Cartão de Crédito' : 'PIX',
      date_register: this.toBRT(tx.createdAt),
      origin: 'SimPay',
      total: amount,
      total_liquid: netAmount,
      fee_total_value: totalFee,
      mdr_value: domFee,
      fee_installment_value: 0,
      client_name: tx.customerName ?? '',
      client_document: tx.customerDocument ?? '',
      client_phone: tx.customerPhone ?? '',
      client_email: tx.customerEmail ?? '',
      paid_date: tx.status === TransactionStatus.COMPLETED ? this.toBRT(tx.updatedAt) : null,
      msg_3ds: null,
      pix_content: tx.pixContent ?? null,
      items: [{ name: tx.description ?? 'Produto', quant: 1, price: amount }],
      historic_status: historicStatus,
    };
  }

  async execute(input: { userId: string; id: string }) {
    // 1. Find local transaction
    const tx = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          { id: input.id, userId: input.userId },
          { domPaymentId: input.id, userId: input.userId },
          { domTransactionId: input.id, userId: input.userId },
        ],
      },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        user: { select: { domToken: true } },
      },
    });

    if (!tx) {
      throw new NotFoundException(`Transação ${input.id} não encontrada.`);
    }

    // 2. Try Dom API using all available IDs (domPaymentId first, then domTransactionId)
    const domToken = tx.user?.domToken;
    const domIdsToTry = [tx.domPaymentId, tx.domTransactionId].filter(Boolean) as string[];

    if (domToken && domIdsToTry.length > 0) {
      for (const domId of domIdsToTry) {
        try {
          const detail = await this.gateway.getDomTransactionDetail(domToken, domId);
          if (detail?.status === 'OK' && detail?.order) {
            return detail;
          }
        } catch {
          // Try next ID
        }
      }
    }

    // 3. Fallback: build from local DB
    return { status: 'OK', order: this.buildFallbackOrder(tx) };
  }
}
