import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaEventsService } from '../events/renovada-events.service';
import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import dayjs from 'dayjs';

@Injectable()
export class RenovadaSyncService implements OnModuleInit {
  private readonly logger = new Logger(RenovadaSyncService.name);
  private readonly RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';
  private readonly RENOVADA_EMAIL = 'pedro.henrique.diniz.2002@hotmail.com';
  private readonly RENOVADA_TOKEN = '4a29df01-a980-45e3-b3c7-1a8b8eb7850f';

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
    private readonly events: RenovadaEventsService,
  ) {}

  onModuleInit() {
    this.logger.log('RenovadaSyncService (Module Specific) initialized');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleSync() {
    if (process.env.DISABLE_RENOVADA_SYNC === 'true') {
      return;
    }

    this.logger.log('🔄 [RENOVADA] Starting background sync...');

    try {
      const beginDate = dayjs().subtract(1, 'hour').format('YYYY-MM-DD');
      
      const response = await this.gateway.listDomTransactions(this.RENOVADA_TOKEN, {
        page: 1,
        limit: 100,
        begin_date: beginDate,
        end_date: dayjs().format('YYYY-MM-DD'),
      });

      if (!response || !Array.isArray(response.transactions)) {
        return;
      }

      for (const domTx of response.transactions) {
        try {
          const domPaymentId = String(domTx.id);
          
          const existingTx = await this.prisma.transaction.findUnique({
            where: { domPaymentId },
          });

          const currentDomStatus = this.mapStatus(domTx.status);

          if (existingTx) {
            if (existingTx.status !== currentDomStatus) {
              await this.updateTransaction(existingTx.id, currentDomStatus, domTx);
            }
            continue;
          }

          // New transaction for Renovada
          const newTx = await this.createTransaction(domTx, currentDomStatus);
          
          // EMIT EVENT for Real-Time UI
          this.events.emitTransaction(newTx);

        } catch (individualError) {
          this.logger.error(`Error processing Renovada tx ${domTx.id}: ${individualError.message}`);
        }
      }

    } catch (error) {
      this.logger.error(`Renovada sync critical error: ${error.message}`);
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

  private async updateTransaction(txId: string, nextStatus: TransactionStatus, domTx: any) {
    const amount = new Prisma.Decimal(domTx.liquid_amount || (domTx.amount * 0.91));

    await this.prisma.$transaction(async (p) => {
      await p.transaction.update({
        where: { id: txId },
        data: { status: nextStatus, updatedAt: new Date() }
      });

      if (nextStatus === TransactionStatus.COMPLETED) {
        await p.wallet.update({
          where: { userId: this.RENOVADA_ID },
          data: { balance: { increment: amount }, version: { increment: 1 } }
        });

        await p.balanceLog.create({
          data: {
            userId: this.RENOVADA_ID,
            action: 'RENOVADA_SYNC_PAID',
            amount,
            source: 'RENOVADA_MODULE_SYNC',
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

  private async createTransaction(domTx: any, status: TransactionStatus) {
    const amount = new Prisma.Decimal(domTx.amount);
    const netAmount = new Prisma.Decimal(domTx.liquid_amount || (domTx.amount * 0.91));

    return await this.prisma.$transaction(async (p) => {
      const tx = await p.transaction.create({
        data: {
          userId: this.RENOVADA_ID,
          amount,
          netAmount,
          status,
          paymentMethod: domTx.payment_method?.toLowerCase().includes('card') ? PaymentMethod.CREDIT_CARD : PaymentMethod.PIX,
          description: domTx.product_first || 'Sincronização Renovada',
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
          where: { userId: this.RENOVADA_ID },
          data: { balance: { increment: netAmount }, version: { increment: 1 } }
        });

        await p.balanceLog.create({
          data: {
            userId: this.RENOVADA_ID,
            action: 'RENOVADA_SYNC_PAID',
            amount: netAmount,
            source: 'RENOVADA_MODULE_SYNC',
            description: `Sync: ${domTx.product_first || 'DOM Transação'}`,
            balanceBefore: 0,
            balanceAfter: 0,
            lockedBefore: 0,
            lockedAfter: 0,
          }
        });
      }
      
      return tx;
    });
  }
}
