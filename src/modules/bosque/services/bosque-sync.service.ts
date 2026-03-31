import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { BosqueEventsService } from '../events/bosque-events.service';
import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const BOSQUE_HIDDEN_TAG = '[TENANT:BOSQUE]';

/**
 * BosqueSyncService — sincroniza transações novas do api-dom para o simpay.
 * Usa o x-access-token do api-dom do Bosque (BOSQUE_APIDOM_XTOKEN) que retorna
 * APENAS transações do Bosque. Igual ao padrão da Renovada.
 */
@Injectable()
export class BosqueSyncService implements OnModuleInit {
  private readonly logger = new Logger(BosqueSyncService.name);
  private readonly BOSQUE_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BosqueEventsService,
    private readonly http: HttpService,
  ) {}

  private buildInternalDescription(description: string | null | undefined): string {
    const base = (description ?? '').trim();
    if (!base) return BOSQUE_HIDDEN_TAG;
    if (base.includes(BOSQUE_HIDDEN_TAG)) return base;
    return `${base} ${BOSQUE_HIDDEN_TAG}`;
  }

  onModuleInit() {
    this.logger.log('[BOSQUE] BosqueSyncService inicializado (api-dom sync mode)');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleSync() {
    if (process.env.DISABLE_BOSQUE_SYNC === 'true') return;

    const API_DOM_URL = process.env.DOM_BACKEND_URL || 'https://api-dom.jbmidia.com';
    const BOSQUE_APIDOM_XTOKEN = process.env.BOSQUE_APIDOM_XTOKEN || '0ba3f139-b1ff-4ded-a5ef-71ccb1c9482f';

    try {
      let created = 0;
      let updated = 0;
      let completedDelta = new Prisma.Decimal(0);

      for (let page = 1; page <= 3; page++) {
        const res = await firstValueFrom(this.http.get<any>(`${API_DOM_URL}/payments/history`, {
          headers: { 'x-access-token': BOSQUE_APIDOM_XTOKEN, 'Accept': 'application/json' },
          params: { page, limit: 100 },
          timeout: 15000,
        }));

        const txList: any[] = res.data?.transactions ?? [];
        if (txList.length === 0) break;

        for (const tx of txList) {
          try {
            const paymentId = tx.paymentId || tx.id;
            const txId = tx.id;

            const existing = await this.prisma.transaction.findFirst({
              where: {
                OR: [
                  ...(paymentId ? [{ domPaymentId: paymentId }] : []),
                  ...(txId ? [{ domTransactionId: txId }] : []),
                ],
              },
            });

            const mappedStatus = this.mapStatus(tx.status);
            const amount      = new Prisma.Decimal(tx.amount || 0);
            const netAmount   = new Prisma.Decimal(tx.amountWithoutAllFee ?? Number(tx.amount || 0) * 0.91);
            const totalFee    = new Prisma.Decimal(tx.fee || 0);
            const domFee      = new Prisma.Decimal(tx.dom_fee || 0);
            const platformFee = totalFee.sub(domFee).lessThan(0) ? new Prisma.Decimal(0) : totalFee.sub(domFee);
            const internalDescription = this.buildInternalDescription(tx.description);

            if (existing) {
              if (existing.status !== mappedStatus) {
                await this.prisma.transaction.update({
                  where: { id: existing.id },
                  data: {
                    status: mappedStatus,
                    previousStatus: existing.status,
                    amount,
                    netAmount,
                    totalFee,
                    domFee,
                    platformFee,
                    description: internalDescription,
                    customerName:     tx.name  || existing.customerName,
                    customerEmail:    tx.email || existing.customerEmail,
                    customerDocument: tx.document || existing.customerDocument,
                    updatedAt: new Date(),
                  },
                });

                updated++;
                this.events.emitTransaction({ ...existing, status: mappedStatus });

                // wallet.balance é bruto — usa amount, não netAmount (igual à Renovada)
                if (existing.status !== TransactionStatus.COMPLETED && mappedStatus === TransactionStatus.COMPLETED) {
                  completedDelta = completedDelta.add(amount);
                }
                if (existing.status === TransactionStatus.COMPLETED && mappedStatus !== TransactionStatus.COMPLETED) {
                  completedDelta = completedDelta.sub(new Prisma.Decimal(existing.amount ?? 0));
                }
              }
              continue;
            }

            const newTx = await this.prisma.transaction.create({
              data: {
                userId:           this.BOSQUE_ID,
                amount,
                netAmount,
                status:           mappedStatus,
                paymentMethod:    this.mapPaymentMethod(tx.payment_method),
                description:      internalDescription,
                domTransactionId: txId,
                domPaymentId:     paymentId,
                customerName:     tx.name,
                customerEmail:    tx.email,
                customerDocument: tx.document,
                customerPhone:    tx.mobile_phone,
                totalFee,
                domFee,
                platformFee,
                installments:     tx.installments || 1,
                createdAt:        new Date(tx.createdAt),
                updatedAt:        tx.updatedAt ? new Date(tx.updatedAt) : new Date(tx.createdAt),
              },
            });

            created++;
            this.events.emitTransaction(newTx);

            // wallet.balance é bruto — usa amount, não netAmount (igual à Renovada)
            if (mappedStatus === TransactionStatus.COMPLETED) {
              completedDelta = completedDelta.add(amount);
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
      if (error.response?.status === 401) {
        this.logger.error('[BOSQUE] Token inválido. Verifique BOSQUE_APIDOM_XTOKEN');
      }
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
