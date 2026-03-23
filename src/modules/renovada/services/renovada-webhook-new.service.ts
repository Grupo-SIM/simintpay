import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, PaymentMethod } from '@prisma/client';
import { createHmac } from 'crypto';

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
export class RenovadaWebhookNewService {
  private readonly logger = new Logger(RenovadaWebhookNewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async processWebhook(event: WebhookEvent): Promise<void> {
    this.logger.log('🔔 [RENOVADA] WEBHOOK RECEBIDO - Processando webhook', {
      signature: event.signature,
      event: event.event,
      paymentId: event.data?.id,
      status: event.data?.status,
    });

    try {
      // Verificar se webhook já foi processado
      const existingEvent = await this.prisma.webhookEvent.findUnique({
        where: { eventId: event.signature },
      });

      if (existingEvent) {
        this.logger.warn(`[RENOVADA] Webhook event ${event.signature} já processado anteriormente`);
        return;
      }

      // Buscar transação pelo paymentId
      const transaction = await this.prisma.transaction.findFirst({
        where: { domPaymentId: event.data.id },
        include: { user: true },
      });

      if (!transaction) {
        this.logger.error(`[RENOVADA] Transaction não encontrada para payment ID: ${event.data.id}`);
        await this.logUnprocessableWebhook(event, 'Transaction not found');
        return;
      }

      this.logger.log('[RENOVADA] ✅ Transaction encontrada:', {
        id: transaction.id,
        status: transaction.status,
        amount: transaction.amount,
        description: transaction.description,
      });

      const newStatus = this.mapPaymentStatus(event.data.status);

      if (!this.isValidStatusTransition(transaction.status, newStatus)) {
        this.logger.error(`[RENOVADA] Invalid status transition from ${transaction.status} to ${newStatus}`);
        await this.logUnprocessableWebhook(event, 'Invalid status transition');
        return;
      }

      // Processamento em uma única transação atômica
      await this.prisma.$transaction(async (prisma) => {
        // Registra primeiro o webhook para garantir idempotência
        await prisma.webhookEvent.create({
          data: {
            eventId: event.signature,
            source: 'DOM_PAGAMENTOS_RENOVADA',
            eventType: event.event,
            payload: event as any,
            status: 'PENDING',
          },
        });

        // Atualiza a transação
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

        // Se status for COMPLETED, atualiza o saldo da wallet
        if (newStatus === TransactionStatus.COMPLETED) {
          const wallet = await prisma.wallet.findUnique({
            where: { userId: transaction.userId },
          });

          if (wallet) {
            const updatedWallet = await prisma.wallet.update({
              where: {
                id: wallet.id,
                version: wallet.version,
              },
              data: {
                balance: { increment: transaction.netAmount || 0 },
                version: { increment: 1 },
              },
            });

            // Registrar BalanceLog
            await prisma.balanceLog.create({
              data: {
                userId: transaction.userId,
                action: 'WEBHOOK_PAID_RENOVADA',
                transactionId: transaction.id,
                amount: transaction.netAmount || 0,
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

            this.logger.log(`[RENOVADA] 💰 Saldo atualizado: ${wallet.balance} → ${updatedWallet.balance}`);
          }
        }
      });

      // Marcar webhook como processado
      await this.prisma.webhookEvent.update({
        where: { eventId: event.signature },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });

      this.logger.log(`[RENOVADA] ✅ Webhook processado com sucesso para transação ${transaction.id}`);
    } catch (error) {
      this.logger.error(`[RENOVADA] ❌ Erro ao processar webhook: ${error.message}`, error.stack);
      
      // Marcar webhook como falha
      await this.prisma.webhookEvent.update({
        where: { eventId: event.signature },
        data: {
          status: 'FAILED',
          error: error.message,
          processedAt: new Date(),
        },
      }).catch(() => {
        // Se falhar ao atualizar, apenas loga
        this.logger.error('[RENOVADA] Falha ao atualizar status do webhook');
      });

      throw new BadRequestException('Erro ao processar webhook');
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
      return true; // Se não tiver secret, permite tudo (ambiente de dev)
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return signature === expectedSignature;
  }
}
