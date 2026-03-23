import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { PAYMENT_GATEWAY } from '../../core/services/payment-gateway.interface';
import { PrismaService } from '../database/prisma/prisma.service';
import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import dayjs from 'dayjs';

@Injectable()
export class SyncDomTransactionsCron implements OnModuleInit {
  private readonly logger = new Logger(SyncDomTransactionsCron.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.logger.log('SyncDomTransactionsCron initialized');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleSync() {
    if (process.env.DISABLE_DOM_SYNC === 'true') {
      return;
    }

    this.logger.log('🔄 [CRON] Starting automatic transaction sync from DOM Pagamentos...');

    try {
      // Fetch 'paid' transactions from last 1 hour
      const beginDate = dayjs().subtract(1, 'hour').format('YYYY-MM-DD');
      
      this.logger.debug(`[CRON] Fetching transactions since ${beginDate}`);

      const response = await this.gateway.listAllTransactionsDirectlyFromDom({
        page: 1,
        limit: 100,
        begin_date: beginDate,
        end_date: dayjs().format('YYYY-MM-DD'),
      });

      if (!response || !Array.isArray(response.transactions)) {
        this.logger.warn('[CRON] No transactions returned from DOM');
        return;
      }

      this.logger.log(`[CRON] Received ${response.transactions.length} transactions from DOM.`);

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const domTx of response.transactions) {
        try {
          const domPaymentId = String(domTx.id);
          
          const existingTx = await this.prisma.transaction.findUnique({
            where: { domPaymentId },
          });

          const currentDomStatus = this.mapStatus(domTx.status);

          if (existingTx) {
            if (existingTx.status !== currentDomStatus) {
              await this.updateTransaction(existingTx.id, existingTx.userId, currentDomStatus, domTx);
              updatedCount++;
            } else {
              skippedCount++;
            }
            continue;
          }

          // NEW TRANSACTION mapping logic
          // Try to map to Renovada or other users based on dom_token/domUserId/labels
          let userId: string | null = null;
          
          // 1. Try to find user by domUserId if available in metadata (needs Detail call)
          const detail = await this.gateway.getDomTransactionDetail(process.env.DOM_TOKEN!, domPaymentId);
          const domUserIdFromDetail = detail?.order?.userId || detail?.userId;
          
          if (domUserIdFromDetail) {
            const user = await this.prisma.user.findUnique({ where: { domUserId: String(domUserIdFromDetail) } });
            if (user) userId = user.id;
          }

          // 2. Fallback for Renovada (Master Account)
          if (!userId) {
             const renovada = await this.prisma.user.findFirst({
               where: { email: 'pedro.henrique.diniz.2002@hotmail.com' }
             });
             if (renovada) userId = renovada.id;
          }

          // 3. Fallback genérico - pega primeiro usuário ativo com tenantModule
          if (!userId) {
            const firstUser = await this.prisma.user.findFirst({
              where: { 
                isActive: true,
                tenantModuleId: { not: null }
              },
              orderBy: { createdAt: 'asc' }
            });
            if (firstUser) userId = firstUser.id;
          }

          // 4. Último fallback - primeiro usuário ativo
          if (!userId) {
            const firstUser = await this.prisma.user.findFirst({
              where: { isActive: true },
              orderBy: { createdAt: 'asc' }
            });
            if (firstUser) userId = firstUser.id;
          }

          if (userId) {
            await this.createTransaction(userId, domTx, currentDomStatus);
            createdCount++;
          } else {
            this.logger.debug(`[CRON] Skip mapping for DOM ID ${domPaymentId}`);
            skippedCount++;
          }

        } catch (individualError) {
          this.logger.error(`[CRON] Transation ID ${domTx.id} error: ${individualError.message}`);
        }
      }

      this.logger.log(`[CRON] Sync Results: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped.`);
    } catch (error) {
      this.logger.error(`[CRON] Critical sync error: ${error.message}`);
    }
  }

  private mapStatus(domStatus: string): TransactionStatus {
    const s = domStatus.toLowerCase();
    if (s === 'paid' || s === 'approved' || s === 'completed') return TransactionStatus.COMPLETED;
    if (s === 'refunded') return TransactionStatus.REFUNDED;
    if (s === 'chargeback') return TransactionStatus.CHARGEBACK;
    if (s === 'failed' || s === 'not_authorized') return TransactionStatus.FAILED;
    if (s === 'expired') return TransactionStatus.EXPIRED;
    return TransactionStatus.PENDING;
  }

  private async updateTransaction(txId: string, userId: string, nextStatus: TransactionStatus, domTx: any) {
    this.logger.log(`[CRON] Updating transaction ${txId} status to ${nextStatus}`);
    
    // We only update balance if it's moving to COMPLETED
    const amount = new Prisma.Decimal(domTx.liquid_amount || (domTx.amount * 0.91));

    await this.prisma.$transaction(async (p) => {
      await p.transaction.update({
        where: { id: txId },
        data: { status: nextStatus, updatedAt: new Date() }
      });

      if (nextStatus === TransactionStatus.COMPLETED) {
        await p.wallet.update({
          where: { userId },
          data: { balance: { increment: amount }, version: { increment: 1 } }
        });

        await p.balanceLog.create({
          data: {
            userId,
            action: 'CRON_PAID',
            amount,
            source: 'CRON_SYNC',
            description: `Sync: ${domTx.product_first || 'DOM Transação'}`,
            balanceBefore: 0,
            balanceAfter: 0,
            lockedBefore: 0,
            lockedAfter: 0,
          }
        });
      }
    });
  }

  private async createTransaction(userId: string, domTx: any, status: TransactionStatus) {
    this.logger.log(`[CRON] Creating sync transaction for user ${userId} DOM ID ${domTx.id}`);
    
    const amount = new Prisma.Decimal(domTx.amount);
    const netAmount = new Prisma.Decimal(domTx.liquid_amount || (domTx.amount * 0.91));

    await this.prisma.$transaction(async (p) => {
      await p.transaction.create({
        data: {
          userId,
          amount,
          netAmount,
          status,
          paymentMethod: domTx.payment_method?.toLowerCase().includes('card') ? PaymentMethod.CREDIT_CARD : PaymentMethod.PIX,
          description: domTx.product_first || 'Sincronização Automática DOM',
          installments: domTx.installments || 1,
          domPaymentId: String(domTx.id),
          customerName: domTx.customer_name,
          customerEmail: domTx.customer_email,
          customerDocument: domTx.customer_document,
          customerPhone: domTx.customer_phone,
          createdAt: domTx.created_at ? new Date(domTx.created_at) : new Date(),
          updatedAt: new Date(),
          platformFee: amount.minus(netAmount),
          domFee: new Prisma.Decimal(domTx.dom_fee || 0),
        }
      });

      if (status === TransactionStatus.COMPLETED) {
        await p.wallet.update({
          where: { userId },
          data: { balance: { increment: netAmount }, version: { increment: 1 } }
        });

        await p.balanceLog.create({
          data: {
            userId,
            action: 'CRON_PAID',
            amount: netAmount,
            source: 'CRON_SYNC',
            description: `Sync: ${domTx.product_first || 'DOM Transação'}`,
            balanceBefore: 0,
            balanceAfter: 0,
            lockedBefore: 0,
            lockedAfter: 0,
          }
        });
      }
    });
  }
}
