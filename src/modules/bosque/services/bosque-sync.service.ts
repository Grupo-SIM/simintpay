import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { BosqueEventsService } from '../events/bosque-events.service';
import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';

/**
 * BosqueSyncService — sincroniza transações recentes da DOM Pagamentos
 * diretamente, sem passar pela api-dom (descontinuada).
 *
 * Usa GET /checkout/production/transactions da DOM com o DOM_TOKEN master.
 * A cada minuto busca as últimas transações e sincroniza as que pertencem
 * ao cod_external de transações do Bosque (userId = BOSQUE_ID).
 */
@Injectable()
export class BosqueSyncService implements OnModuleInit {
  private readonly logger = new Logger(BosqueSyncService.name);
  private readonly BOSQUE_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
  private readonly DOM_API = 'https://apiv3.dompagamentos.com.br/checkout/production';

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BosqueEventsService,
  ) {}

  onModuleInit() {
    this.logger.log('[BOSQUE] BosqueSyncService inicializado (DOM Pagamentos sync mode)');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleSync() {
    if (process.env.DISABLE_BOSQUE_SYNC === 'true') return;

    const token = process.env.DOM_TOKEN;
    if (!token) {
      this.logger.error('[BOSQUE] DOM_TOKEN não configurado');
      return;
    }

    try {
      let created = 0;
      let updated = 0;

      // Busca as últimas páginas de transações da DOM
      for (let page = 1; page <= 3; page++) {
        const res = await fetch(`${this.DOM_API}/transactions?page=${page}&limit=100`, {
          headers: {
            Authorization: `Bearer ${token}`,
            accept: 'application/json',
          },
        });

        if (!res.ok) {
          this.logger.warn(`[BOSQUE] Erro DOM (página ${page}): ${res.status}`);
          break;
        }

        const body = await res.json() as any;
        const txList: any[] = body?.data ?? body?.transactions ?? [];

        if (txList.length === 0) break;

        for (const tx of txList) {
          try {
            // O cod_external é o ID da transação no nosso banco (uuid)
            const codExternal = tx.cod_external as string | undefined;

            // Só processar se a transação pertence ao Bosque (cod_external existir no banco do Bosque)
            if (!codExternal) continue;

            const existing = await this.prisma.transaction.findFirst({
              where: {
                userId: this.BOSQUE_ID,
                OR: [
                  { id: codExternal },
                  { domPaymentId: tx.id },
                ],
              },
            });

            const mappedStatus = this.mapStatus(tx.status);
            const amount = new Prisma.Decimal(tx.amount || 0);
            const netAmount = new Prisma.Decimal(Number(tx.amount || 0) * 0.91);

            if (existing) {
              if (existing.status !== mappedStatus) {
                await this.prisma.transaction.update({
                  where: { id: existing.id },
                  data: {
                    status: mappedStatus,
                    previousStatus: existing.status,
                    domPaymentId: existing.domPaymentId ?? tx.id,
                    updatedAt: new Date(),
                  },
                });

                if (mappedStatus === TransactionStatus.COMPLETED && existing.status !== TransactionStatus.COMPLETED) {
                  await this.prisma.wallet.update({
                    where: { userId: this.BOSQUE_ID },
                    data: { balance: { increment: existing.netAmount ?? netAmount }, version: { increment: 1 } },
                  });
                }

                updated++;
                this.events.emitTransaction({ ...existing, status: mappedStatus });
              }
              continue;
            }

            // Se não existe e o cod_external corresponde a um userId Bosque, criar
            // (caso raro: transação criada por outro caminho)
            const paymentMethod = this.mapPaymentMethod(tx.payment_method);

            const newTx = await this.prisma.transaction.create({
              data: {
                id: codExternal,
                userId: this.BOSQUE_ID,
                amount,
                netAmount,
                status: mappedStatus,
                paymentMethod,
                description: tx.items?.[0]?.description || 'Sincronização Bosque',
                domPaymentId: tx.id,
                customerName: tx.customer?.name,
                customerEmail: tx.customer?.email,
                customerDocument: tx.customer?.document,
                customerPhone: tx.customer?.mobile_phone,
                totalFee: new Prisma.Decimal(Number(tx.amount || 0) * 0.09),
                domFee: new Prisma.Decimal(Number(tx.amount || 0) * 0.09),
                platformFee: new Prisma.Decimal(0),
                installments: Number(tx.installments) || 1,
                createdAt: new Date(tx.created_at || new Date()),
                updatedAt: new Date(tx.updated_at || new Date()),
              },
            });

            if (mappedStatus === TransactionStatus.COMPLETED) {
              await this.prisma.wallet.update({
                where: { userId: this.BOSQUE_ID },
                data: { balance: { increment: netAmount }, version: { increment: 1 } },
              });
            }

            created++;
            this.events.emitTransaction(newTx);
          } catch (err: any) {
            if (err.code !== 'P2002') {
              this.logger.warn(`[BOSQUE] Erro ao processar tx: ${err.message}`);
            }
          }
        }

        if (txList.length < 100) break;
      }

      if (created > 0 || updated > 0) {
        this.logger.log(`[BOSQUE] Sync: ${created} criadas, ${updated} atualizadas`);
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
