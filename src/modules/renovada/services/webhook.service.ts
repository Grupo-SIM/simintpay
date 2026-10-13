import { getPlatformOwnerId } from '../../module.registry';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import { getPlatformTaxaEffective } from '../../platform-taxas/platform-taxas.store';
import { CheckoutEventsService } from '../../../application/services/checkout-events.service';


interface WebhookEvent {
  event: string;
  signature: string;
  data: PaymentData;
}

interface PaymentData {
  id: string;
  created_at: string;
  updated_at: string;
  cod_external: string;
  amount: number;
  currency: string;
  status: string;
  payment_method: string;
  card_code_auth: string | null;
  card_brand: string | null;
  card_bin: string | null;
  installments: string;
  boleto_url: string | null;
  pix_qrcode: string;
  pix_content: string;
  pix_expire: string;
  items: Array<{
    description: string;
    price: number;
    quantity: number;
  }>;
  customer: {
    name: string;
    email: string;
    mobile_phone: string;
    document: string;
    document_type: string;
    birthdate: string;
    gender: string;
  };
  shipping: any | null;
  metadata: string;
  postbackUrl: string;
  serial_number: string;
}

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
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
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly checkoutEvents?: CheckoutEventsService,
  ) {}

  async processWebhook(event: WebhookEvent): Promise<void> {
    this.logger.log('[RENOVADA] Webhook recebido', {
      signature: event.signature,
      event: event.event,
      paymentId: event.data?.id,
      status: event.data?.status,
    });

    try {
      // Idempotência atômica: tenta inserir e captura P2002 (unique violation)
      try {
        await this.prisma.webhookEvent.create({
          data: {
            eventId: event.signature,
            source: 'DOM_PAGAMENTOS_RENOVADA',
            eventType: event.event,
            payload: event as any,
            status: 'PENDING',
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          this.logger.warn(`[RENOVADA] Webhook event ${event.signature} já processado anteriormente`);
          return;
        }
        throw err;
      }

      // Buscar transação pelo paymentId
      let transaction = await this.prisma.transaction.findFirst({
        where: { domPaymentId: event.data.id },
        include: { user: true },
      });

      if (!transaction) {
        const ownerId = getPlatformOwnerId('RENOVADA');
        if (!ownerId) throw new Error('Plataforma Renovada não cadastrada com dono.');
        this.logger.log(`[RENOVADA] Transação ${event.data.id} não encontrada — criando via webhook`);
        // DOM Pagamentos envia amount em CENTAVOS → dividir por 100
        const amount = new Prisma.Decimal((event.data.amount || 0) / 100);
        const fatorLiquidez = getPlatformTaxaEffective('RENOVADA', 'LIQUIDEZ', 0.91);
        const netAmountEst = amount.mul(new Prisma.Decimal(fatorLiquidez));
        const isCard = (event.data.payment_method || '').toLowerCase().includes('card');
        try {
          transaction = await this.prisma.transaction.create({
            data: {
              userId: ownerId,
              domPaymentId: event.data.id,
              status: TransactionStatus.PENDING,
              amount,
              netAmount: netAmountEst,
              totalFee: new Prisma.Decimal(0),
              domFee: new Prisma.Decimal(0),
              platformFee: new Prisma.Decimal(0),
              paymentMethod: isCard ? PaymentMethod.CREDIT_CARD : PaymentMethod.PIX,
              description: event.data.items?.[0]?.description || null,
              customerName: event.data.customer?.name || null,
              customerEmail: event.data.customer?.email || null,
              customerDocument: event.data.customer?.document || null,
              customerPhone: event.data.customer?.mobile_phone || null,
              installments: parseInt(event.data.installments || '1', 10) || 1,
              createdAt: event.data.created_at ? new Date(event.data.created_at) : new Date(),
            },
            include: { user: true },
          });
          this.logger.log(`[RENOVADA] Transação criada via webhook: ${transaction.id}`);
        } catch (createErr: any) {
          if (createErr.code === 'P2002') {
            transaction = await this.prisma.transaction.findFirst({
              where: { domPaymentId: event.data.id },
              include: { user: true },
            });
          }
          if (!transaction) {
        const ownerId = getPlatformOwnerId('RENOVADA');
        if (!ownerId) throw new Error('Plataforma Renovada não cadastrada com dono.');
            this.logger.error(`[RENOVADA] Falha ao criar transação para ${event.data.id}: ${createErr.message}`);
            await this.logUnprocessableWebhook(event, 'Transaction not found and could not be created');
            return;
          }
        }
      }

      const newStatus = this.mapPaymentStatus(event.data.status);

      if (!this.isValidStatusTransition(transaction.status, newStatus)) {
        this.logger.error(`[RENOVADA] Invalid status transition from ${transaction.status} to ${newStatus}`);
        await this.logUnprocessableWebhook(event, 'Invalid status transition');
        return;
      }

      await this.prisma.$transaction(async (prisma) => {
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

        if (newStatus === TransactionStatus.COMPLETED && transaction.status !== TransactionStatus.COMPLETED) {
          // SSE: confirma o pagamento no app em tempo real (checkout/pix/:paymentId/sse)
          this.checkoutEvents?.emit({ domPaymentId: event.data.id, status: 'COMPLETED' });
          const wallet = await prisma.wallet.findUnique({
            where: { userId: transaction.userId },
          });

          if (wallet) {
            const balanceIncrement = new Prisma.Decimal(transaction.amount || 0);
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
                action: 'WEBHOOK_PAID_RENOVADA',
                transactionId: transaction.id,
                amount: balanceIncrement,
                balanceBefore: wallet.balance,
                balanceAfter: updatedWallet.balance,
                lockedBefore: wallet.lockedBalance,
                lockedAfter: updatedWallet.lockedBalance,
                description: transaction.description,
                source: 'WEBHOOK_RENOVADA',
                metadata: {
                  signature: event.signature,
                  eventStatus: event.data.status,
                  transactionAmount: transaction.amount,
                },
              },
            });
          }
        }

        if (
          (newStatus === TransactionStatus.REFUNDED || newStatus === TransactionStatus.CHARGEBACK) &&
          transaction.status === TransactionStatus.COMPLETED
        ) {
          const wallet = await prisma.wallet.findUnique({
            where: { userId: transaction.userId },
          });

          if (wallet) {
            const balanceDecrement = new Prisma.Decimal(transaction.amount || 0);
            const updatedWallet = await prisma.wallet.update({
              where: { id: wallet.id, version: wallet.version },
              data: {
                balance: { decrement: balanceDecrement },
                version: { increment: 1 },
              },
            });

            await prisma.balanceLog.create({
              data: {
                userId: transaction.userId,
                action: `WEBHOOK_${newStatus}_RENOVADA`,
                transactionId: transaction.id,
                amount: balanceDecrement,
                balanceBefore: wallet.balance,
                balanceAfter: updatedWallet.balance,
                lockedBefore: wallet.lockedBalance,
                lockedAfter: updatedWallet.lockedBalance,
                description: `Estorno: ${transaction.description}`,
                source: 'WEBHOOK_RENOVADA',
                metadata: {
                  signature: event.signature,
                  eventStatus: event.data.status,
                  transactionAmount: transaction.amount,
                },
              },
            });
          }
        }
      });

      await this.prisma.webhookEvent.update({
        where: { eventId: event.signature },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });

      this.logger.log(`[RENOVADA] Webhook processado com sucesso para transação ${transaction.id}`);
    } catch (error: any) {
      this.logger.error(`[RENOVADA] Erro ao processar webhook: ${error.message}`, error.stack);

      await this.prisma.webhookEvent.update({
        where: { eventId: event.signature },
        data: {
          status: 'FAILED',
          error: error.message,
          processedAt: new Date(),
        },
      }).catch(() => {
        this.logger.error('[RENOVADA] Falha ao atualizar status do webhook');
      });
    }
  }

  private mapPaymentStatus(domStatus: string): TransactionStatus {
    const s = domStatus.toLowerCase();
    if (s === 'paid' || s === 'approved' || s === 'completed') return TransactionStatus.COMPLETED;
    if (s === 'refunded') return TransactionStatus.REFUNDED;
    if (s === 'chargeback') return TransactionStatus.CHARGEBACK;
    if (s === 'in_mediation') return TransactionStatus.IN_MEDIATION;
    if (s === 'failed' || s === 'not_authorized') return TransactionStatus.FAILED;
    if (s === 'expired') return TransactionStatus.EXPIRED;
    return TransactionStatus.PENDING;
  }

  private isValidStatusTransition(
    currentStatus: TransactionStatus,
    newStatus: TransactionStatus,
  ): boolean {
    const validTransitions = VALID_STATUS_TRANSITIONS[currentStatus as keyof typeof VALID_STATUS_TRANSITIONS];
    return validTransitions ? validTransitions.includes(newStatus) : false;
  }

  private async logUnprocessableWebhook(event: WebhookEvent, reason: string): Promise<void> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          eventId: event.signature,
          source: 'DOM_PAGAMENTOS_RENOVADA',
          eventType: event.event,
          payload: event as any,
          status: 'UNPROCESSABLE',
          error: reason,
        },
      });
    } catch (error) {
      this.logger.error('[RENOVADA] Erro ao logar webhook não processável:', error);
    }
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const secret = process.env.DOM_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.warn('[RENOVADA] DOM_WEBHOOK_SECRET não configurado');
      return true;
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return signature === expectedSignature;
  }
}
