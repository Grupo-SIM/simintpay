import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import { BosqueEventsService } from '../events/bosque-events.service';
import { CheckoutEventsService } from '../../../application/services/checkout-events.service';

interface WebhookEvent {
  event: string;
  signature: string;
  data: {
    id: string;
    created_at: string;
    updated_at: string;
    cod_external: string;
    amount: number;
    status: string;
    payment_method: string;
    installments: string;
    pix_qrcode: string;
    pix_content: string;
    pix_expire: string;
    items: Array<{ description: string; price: number; quantity: number }>;
    customer: {
      name: string;
      email: string;
      mobile_phone: string;
      document: string;
      document_type: string;
    };
    metadata: string;
  };
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING'],
  PENDING: ['COMPLETED', 'FAILED', 'REFUNDED', 'EXPIRED', 'PENDING'],
  COMPLETED: ['REFUNDED', 'CHARGEBACK', 'IN_MEDIATION'],
  IN_MEDIATION: ['COMPLETED', 'REFUNDED', 'CHARGEBACK'],
  FAILED: [],
  REFUNDED: [],
  CHARGEBACK: ['COMPLETED'],
  EXPIRED: [],
};

@Injectable()
export class BosqueWebhookService {
  private readonly logger = new Logger(BosqueWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BosqueEventsService,
    @Optional() private readonly checkoutEvents?: CheckoutEventsService,
  ) {}

  async processWebhook(event: WebhookEvent): Promise<void> {
    this.logger.log('[BOSQUE] Webhook recebido', {
      event: event.event,
      paymentId: event.data?.id,
      status: event.data?.status,
    });

    try {
      const existingEvent = await this.prisma.webhookEvent.findUnique({
        where: { eventId: event.signature },
      });

      if (existingEvent) {
        this.logger.warn(`[BOSQUE] Webhook ${event.signature} já processado`);
        return;
      }

      const transaction = await this.prisma.transaction.findFirst({
        where: { domPaymentId: event.data.id },
        include: { user: true },
      });

      if (!transaction) {
        this.logger.error(`[BOSQUE] Transação não encontrada para payment ID: ${event.data.id}`);
        await this.logUnprocessable(event, 'Transaction not found');
        return;
      }

      const newStatus = this.mapStatus(event.data.status);

      const validTransitions = VALID_TRANSITIONS[transaction.status];
      if (!validTransitions?.includes(newStatus)) {
        this.logger.error(`[BOSQUE] Transição inválida: ${transaction.status} → ${newStatus}`);
        await this.logUnprocessable(event, 'Invalid status transition');
        return;
      }

      await this.prisma.$transaction(async (prisma) => {
        await prisma.webhookEvent.create({
          data: {
            eventId: event.signature,
            source: 'DOM_PAGAMENTOS_BOSQUE',
            eventType: event.event,
            payload: event as any,
            status: 'PENDING',
          },
        });

        await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: newStatus,
            updatedAt: new Date(),
            previousStatus: transaction.status,
            statusHistory: {
              create: {
                fromStatus: transaction.status,
                toStatus: newStatus,
                metadata: { webhookEvent: event.signature },
              },
            },
          },
        });

        // wallet.balance recebe o LÍQUIDO (netAmount) — exatamente o "Valor Recebido"
        // exibido na listagem (netAmount ?? amount). Antes creditava o BRUTO (amount),
        // o que inflava o saldo disponível com as taxas DOM/plataforma já descontadas.
        const balanceIncrement = new Prisma.Decimal(transaction.netAmount ?? transaction.amount ?? 0);

        if (newStatus === TransactionStatus.COMPLETED && transaction.status !== TransactionStatus.COMPLETED) {
          // SSE: confirma o pagamento no app em tempo real (checkout/pix/:paymentId/sse)
          this.checkoutEvents?.emit({ domPaymentId: event.data.id, status: 'COMPLETED' });
          const wallet = await prisma.wallet.findUnique({
            where: { userId: transaction.userId },
          });

          if (wallet) {
            const updatedWallet = await prisma.wallet.update({
              where: { id: wallet.id, version: wallet.version },
              data: {
                balance: { increment: balanceIncrement },
                version: { increment: 1 },
              },
            });

            await prisma.balanceLog.create({
              data: {
                userId: transaction.userId,
                action: 'WEBHOOK_PAID_BOSQUE',
                transactionId: transaction.id,
                amount: balanceIncrement,
                balanceBefore: wallet.balance,
                balanceAfter: updatedWallet.balance,
                lockedBefore: wallet.lockedBalance,
                lockedAfter: updatedWallet.lockedBalance,
                description: transaction.description,
                source: 'WEBHOOK_BOSQUE',
                metadata: {
                  signature: event.signature,
                  eventStatus: event.data.status,
                  transactionAmount: transaction.amount,
                },
              },
            });

            this.logger.log(`[BOSQUE] Saldo atualizado: ${wallet.balance} → ${updatedWallet.balance}`);
          }
        }

        // Estorno/chargeback: debita o saldo
        if (
          (newStatus === TransactionStatus.REFUNDED || newStatus === TransactionStatus.CHARGEBACK) &&
          transaction.status === TransactionStatus.COMPLETED
        ) {
          const wallet = await prisma.wallet.findUnique({
            where: { userId: transaction.userId },
          });

          if (wallet) {
            const updatedWallet = await prisma.wallet.update({
              where: { id: wallet.id, version: wallet.version },
              data: {
                balance: { decrement: balanceIncrement },
                version: { increment: 1 },
              },
            });

            await prisma.balanceLog.create({
              data: {
                userId: transaction.userId,
                action: `WEBHOOK_${newStatus}_BOSQUE`,
                transactionId: transaction.id,
                amount: balanceIncrement,
                balanceBefore: wallet.balance,
                balanceAfter: updatedWallet.balance,
                lockedBefore: wallet.lockedBalance,
                lockedAfter: updatedWallet.lockedBalance,
                description: `Estorno: ${transaction.description}`,
                source: 'WEBHOOK_BOSQUE',
                metadata: {
                  signature: event.signature,
                  eventStatus: event.data.status,
                  transactionAmount: transaction.amount,
                },
              },
            });

            this.logger.log(`[BOSQUE] Estorno debitado: ${wallet.balance} → ${updatedWallet.balance}`);
          }
        }
      });

      this.events.emitTransaction({
        id: transaction.id,
        userId: transaction.userId,
        status: newStatus,
        amount: transaction.amount,
        netAmount: transaction.netAmount,
        description: transaction.description,
        domPaymentId: transaction.domPaymentId,
      });

      await this.prisma.webhookEvent.update({
        where: { eventId: event.signature },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });

      this.logger.log(`[BOSQUE] Webhook processado com sucesso para transação ${transaction.id}`);
    } catch (error) {
      this.logger.error(`[BOSQUE] Erro ao processar webhook: ${error.message}`, error.stack);

      await this.prisma.webhookEvent
        .update({
          where: { eventId: event.signature },
          data: { status: 'FAILED', error: error.message, processedAt: new Date() },
        })
        .catch(() => {});

      throw new BadRequestException('Erro ao processar webhook');
    }
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const secret = process.env.DOM_WEBHOOK_SECRET;
    if (!secret) return true;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    return signature === expected;
  }

  private mapStatus(domStatus: string): TransactionStatus {
    const s = domStatus.toLowerCase();
    if (s === 'paid' || s === 'approved' || s === 'completed') return TransactionStatus.COMPLETED;
    if (s === 'refunded') return TransactionStatus.REFUNDED;
    if (s === 'chargeback') return TransactionStatus.CHARGEBACK;
    if (s === 'in_mediation') return TransactionStatus.IN_MEDIATION;
    if (s === 'failed' || s === 'not_authorized') return TransactionStatus.FAILED;
    if (s === 'expired') return TransactionStatus.EXPIRED;
    return TransactionStatus.PENDING;
  }

  private async logUnprocessable(event: WebhookEvent, reason: string): Promise<void> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          eventId: event.signature,
          source: 'DOM_PAGAMENTOS_BOSQUE',
          eventType: event.event,
          payload: event as any,
          status: 'UNPROCESSABLE',
          error: reason,
        },
      });
    } catch {}
  }
}
