import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaEventsService } from '../events/renovada-events.service';
import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { appendInternalTags, TENANT_RENOVADA_TAG } from '../../../application/utils/internal-tags.util';

/**
 * RenovadaSyncService - Sincroniza transações novas do api-dom para o back-simpay.
 *
 * O app mobile (versão deployada) ainda cria pagamentos via api-dom.
 * Precisamos puxar transações novas do api-dom periodicamente.
 *
 * Usa o x-access-token do api-dom (4a29df01...) que retorna APENAS
 * transações da Renovada. NÃO usa o master token DOM.
 *
 * IMPORTANTE: O cron gerencia wallet.balance incrementalmente.
 * O saldo parte de um valor base definido via POST /admin/sync/sync-wallet-renovada
 * e é atualizado apenas com deltas de novas transações COMPLETED e saques aprovados.
 */
@Injectable()
export class RenovadaSyncService implements OnModuleInit {
  private readonly logger = new Logger(RenovadaSyncService.name);
  private readonly RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RenovadaEventsService,
    private readonly http: HttpService,
  ) {}

  onModuleInit() {
    this.logger.log('RenovadaSyncService initialized (api-dom sync mode)');
  }

  /**
   * A cada minuto, busca transações recentes do api-dom e sincroniza.
   * Atualiza wallet.balance incrementalmente: +netAmount por nova transação COMPLETED.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleSync() {
    if (process.env.DISABLE_RENOVADA_SYNC === 'true') {
      return;
    }

    const API_DOM_URL = process.env.DOM_BACKEND_URL || 'https://api-dom.jbmidia.com';
    const RENOVADA_API_DOM_TOKEN = process.env.RENOVADA_APIDOM_XTOKEN || '4a29df01-a980-45e3-b3c7-1a8b8eb7850f';

    try {
      // Buscar as transações mais recentes do api-dom (páginas 1 a 3 = últimas 300)
      let created = 0;
      let updated = 0;
      // Delta incremental: quanto somar/subtrair do saldo desta rodada
      // wallet.balance é o saldo BRUTO; netBalance = balance * fatorLiquidez
      // Usar amount (bruto) diretamente — NÃO netAmount/fatorLiquidez
      // liquid_amount do DOM reflete taxas DOM, não o fatorLiquidez do negócio
      let completedDelta = new Prisma.Decimal(0);

      for (let page = 1; page <= 3; page++) {
        const res = await firstValueFrom(this.http.get<any>(`${API_DOM_URL}/payments/history`, {
          headers: {
            'x-access-token': RENOVADA_API_DOM_TOKEN,
            'Accept': 'application/json',
          },
          params: { page, limit: 100 },
          timeout: 15000,
        }));

        const txList: any[] = res.data?.transactions ?? [];
        if (txList.length === 0) break;

        for (const tx of txList) {
          try {
            // Ignorar transações de assinaturas de planos (não pertencem à Renovada)
            if ((tx.description || '').startsWith('PIX_PLAN_CODE:')) {
              continue;
            }

            // Ignorar transações que não possuem keywords da Renovada na descrição
            const desc = (tx.description || '').toLowerCase();
            const renovadaKeywords = ['dizimo', 'dízimo', 'primicia', 'primícia', 'oferta', 'fundacao', 'fundação', 'maquineta', 'terminal'];
            const isRenovadaTx = renovadaKeywords.some(k => desc.includes(k));
            if (!isRenovadaTx) {
              continue;
            }

            const paymentId = tx.paymentId || tx.id;
            const txId = tx.id;

            // Verificar se já existe
            const existing = await this.prisma.transaction.findFirst({
              where: {
                OR: [
                  ...(paymentId ? [{ domPaymentId: paymentId }] : []),
                  ...(txId ? [{ domTransactionId: txId }] : []),
                ],
              },
            });

            const mappedStatus = this.mapStatus(tx.status);
            const amount = new Prisma.Decimal(tx.amount || 0);
            const netAmount = new Prisma.Decimal(tx.amountWithoutAllFee ?? Number(tx.amount || 0) * 0.91);
            const totalFee = new Prisma.Decimal(tx.fee || 0);
            const domFee = new Prisma.Decimal(tx.dom_fee || 0);
            const platformFee = totalFee.sub(domFee).lessThan(0) ? new Prisma.Decimal(0) : totalFee.sub(domFee);
            const internalDescription = appendInternalTags(
              tx.description || existing?.description || 'Sincronização Renovada',
              [TENANT_RENOVADA_TAG],
            );

            if (existing) {
              // Só atualizar se status mudou
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
                    customerName: tx.name || existing.customerName,
                    customerEmail: tx.email || existing.customerEmail,
                    customerDocument: tx.document || existing.customerDocument,
                    updatedAt: new Date(),
                  },
                });

                updated++;
                this.events.emitTransaction({ ...existing, status: mappedStatus });

                // Transição para COMPLETED: soma amount (bruto) ao delta
                if (existing.status !== TransactionStatus.COMPLETED && mappedStatus === TransactionStatus.COMPLETED) {
                  completedDelta = completedDelta.add(amount);
                }
                // Transição de COMPLETED para outro: subtrai amount bruto anterior
                if (existing.status === TransactionStatus.COMPLETED && mappedStatus !== TransactionStatus.COMPLETED) {
                  completedDelta = completedDelta.sub(new Prisma.Decimal(existing.amount ?? 0));
                }
              }
              continue;
            }

            // Fallback: busca diretamente por domPaymentId antes de criar
            // (evita P2002 quando findFirst acima falha por mapeamento de campos divergente)
            const byPaymentId = await this.prisma.transaction.findFirst({
              where: { domPaymentId: paymentId },
            });
            if (byPaymentId) {
              if (byPaymentId.status !== mappedStatus) {
                await this.prisma.transaction.update({
                  where: { id: byPaymentId.id },
                  data: {
                    status: mappedStatus,
                    previousStatus: byPaymentId.status,
                    amount,
                    netAmount,
                    totalFee,
                    domFee,
                    platformFee,
                    updatedAt: new Date(),
                  },
                });
                updated++;
                if (byPaymentId.status !== TransactionStatus.COMPLETED && mappedStatus === TransactionStatus.COMPLETED) {
                  completedDelta = completedDelta.add(amount);
                }
                if (byPaymentId.status === TransactionStatus.COMPLETED && mappedStatus !== TransactionStatus.COMPLETED) {
                  completedDelta = completedDelta.sub(new Prisma.Decimal(byPaymentId.amount ?? 0));
                }
              }
              continue;
            }

            // Criar nova transação
            const newTx = await this.prisma.transaction.create({
              data: {
                userId: this.RENOVADA_ID,
                amount,
                netAmount,
                status: mappedStatus,
                paymentMethod: this.mapPaymentMethod(tx.payment_method),
                description: internalDescription,
                domTransactionId: txId,
                domPaymentId: paymentId,
                customerName: tx.name,
                customerEmail: tx.email,
                customerDocument: tx.document,
                customerPhone: tx.mobile_phone,
                totalFee,
                domFee,
                platformFee,
                installments: tx.installments || 1,
                createdAt: new Date(tx.createdAt),
                updatedAt: tx.updatedAt ? new Date(tx.updatedAt) : new Date(tx.createdAt),
              },
            });

            created++;
            this.events.emitTransaction(newTx);

            // Nova transação já COMPLETED: soma amount (bruto) ao delta
            if (mappedStatus === TransactionStatus.COMPLETED) {
              completedDelta = completedDelta.add(amount);
            }
          } catch (err: any) {
            if (err.code !== 'P2002') {
              this.logger.warn(`Erro ao processar transação: ${err.message}`);
            }
          }
        }

        // Se a primeira página tem menos de 100, não precisa buscar mais
        if (txList.length < 100) break;
      }

      if (created > 0 || updated > 0) {
        this.logger.log(`[RENOVADA] Sync: ${created} criadas, ${updated} atualizadas`);

        // Atualizar saldo incrementalmente (não recalcular do zero — saldo base foi definido manualmente)
        if (!completedDelta.equals(0)) {
          await this.prisma.wallet.update({
            where: { userId: this.RENOVADA_ID },
            data: {
              balance: { increment: completedDelta },
              version: { increment: 1 },
            },
          });
          this.logger.log(`[RENOVADA] 💰 Saldo ajustado em R$ ${completedDelta.toFixed(2)} (bruto)`);
        }
      }
    } catch (error: any) {
      this.logger.error(`[RENOVADA] Sync error: ${error.message}`);
      if (error.response?.status === 401) {
        this.logger.error(`[RENOVADA] Token inválido. Verifique RENOVADA_APIDOM_XTOKEN`);
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
