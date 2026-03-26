import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { BosqueEventsService } from '../events/bosque-events.service';
import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import dayjs from 'dayjs';

/**
 * BosqueSyncService — sincroniza transações recentes da DOM Pagamentos
 * usando o ApiDomClient (PAYMENT_GATEWAY), igual ao padrão da Renovada.
 *
 * Saldo gerenciado incrementalmente via completedDelta por rodada.
 */
@Injectable()
export class BosqueSyncService implements OnModuleInit {
  private readonly logger = new Logger(BosqueSyncService.name);
  private readonly BOSQUE_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BosqueEventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  onModuleInit() {
    this.logger.log('[BOSQUE] BosqueSyncService inicializado (DOM Pagamentos direto)');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleSync() {
    if (process.env.DISABLE_BOSQUE_SYNC === 'true') return;

    const token = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!token) {
      this.logger.error('[BOSQUE] DOM_TOKEN não configurado');
      return;
    }

    try {
      let created = 0;
      let updated = 0;
      let completedDelta = new Prisma.Decimal(0);

      // Busca últimos 2 dias (dentro do limite de 3 meses da DOM)
      const begin_date = dayjs().subtract(2, 'day').format('YYYY-MM-DD');
      const end_date   = dayjs().format('YYYY-MM-DD');

      for (let page = 1; page <= 3; page++) {
        const result = await this.gateway.listDomTransactions(token, {
          page,
          limit: 100,
          begin_date,
          end_date,
        });

        const txList = result.transactions ?? [];
        if (txList.length === 0) break;

        for (const tx of txList) {
          try {
            const domPaymentId = tx.id;
            const codExternal  = tx.externalRef ?? tx.id;

            const existing = await this.prisma.transaction.findFirst({
              where: {
                userId: this.BOSQUE_ID,
                OR: [{ domPaymentId }, { id: codExternal }],
              },
            });

            if (!existing) continue; // só atualiza — novas transações do Bosque chegam via webhook

            const mappedStatus = this.mapStatus(tx.status);

            if (existing.status !== mappedStatus) {
              await this.prisma.transaction.update({
                where: { id: existing.id },
                data: {
                  status: mappedStatus,
                  previousStatus: existing.status,
                  domPaymentId: existing.domPaymentId ?? domPaymentId,
                  updatedAt: new Date(),
                },
              });

              if (existing.status !== TransactionStatus.COMPLETED && mappedStatus === TransactionStatus.COMPLETED) {
                completedDelta = completedDelta.add(new Prisma.Decimal(existing.netAmount ?? 0));
              }
              if (existing.status === TransactionStatus.COMPLETED && mappedStatus !== TransactionStatus.COMPLETED) {
                completedDelta = completedDelta.sub(new Prisma.Decimal(existing.netAmount ?? 0));
              }

              updated++;
              this.events.emitTransaction({ ...existing, status: mappedStatus });
            }
          } catch (err: any) {
            if (err.code !== 'P2002') this.logger.warn(`[BOSQUE] Erro tx: ${err.message}`);
          }
        }

        if (txList.length < 100) break;
      }

      if (created > 0 || updated > 0) {
        this.logger.log(`[BOSQUE] Sync: ${created} criadas, ${updated} atualizadas`);

        if (!completedDelta.equals(0)) {
          await this.prisma.wallet.update({
            where: { userId: this.BOSQUE_ID },
            data: { balance: { increment: completedDelta }, version: { increment: 1 } },
          });
          this.logger.log(`[BOSQUE] Saldo ajustado em R$ ${completedDelta.toFixed(2)}`);
        }
      }
    } catch (error: any) {
      this.logger.error(`[BOSQUE] Sync error: ${error.message}`);
    }
  }

  private mapStatus(domStatus: string): TransactionStatus {
    const s = (domStatus || '').toUpperCase();
    if (s === 'PAID' || s === 'APPROVED' || s === 'COMPLETED') return TransactionStatus.COMPLETED;
    if (s === 'PENDING' || s === 'WAITING' || s === 'AUTHORIZED') return TransactionStatus.PENDING;
    if (s === 'REFUSED' || s === 'CANCELED' || s === 'FAILED' || s === 'ERROR' || s === 'NOT_AUTHORIZED') return TransactionStatus.FAILED;
    if (s === 'REFUNDED') return TransactionStatus.REFUNDED;
    if (s === 'EXPIRED') return TransactionStatus.EXPIRED;
    if (s === 'CHARGEBACK') return TransactionStatus.CHARGEBACK;
    return TransactionStatus.PENDING;
  }

  private mapPaymentMethod(domMethod: string): PaymentMethod {
    const m = (domMethod || '').toLowerCase();
    if (m.includes('pix')) return PaymentMethod.PIX;
    if (m.includes('card') || m.includes('credit')) return PaymentMethod.CREDIT_CARD;
    return PaymentMethod.PIX;
  }
}
