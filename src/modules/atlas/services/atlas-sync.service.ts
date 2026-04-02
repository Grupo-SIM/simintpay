import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { AtlasEventsService } from '../events/atlas-events.service';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import dayjs from 'dayjs';
import { getPlatformTaxaEffective } from '../../platform-taxas/platform-taxas.store';

/**
 * AtlasSyncService — Sincroniza transações do Atlas a partir da API v3 da DOM.
 *
 * IMPORTANTE: Usa a DOM API v3 DIRETAMENTE (never api-dom.jbmidia.com).
 * Autenticação: Authorization Bearer {ATLAS_DOM_TOKEN}
 * Filtra transações cuja descrição contenha "atlas".
 */
@Injectable()
export class AtlasSyncService implements OnModuleInit {
  private readonly logger = new Logger(AtlasSyncService.name);
  private atlasUserId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AtlasEventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async onModuleInit() {
    this.logger.log('[ATLAS] Sync service initialized (DOM API v3 mode)');
    await this.resolveAtlasUserId();
  }

  private async resolveAtlasUserId(): Promise<string | null> {
    if (this.atlasUserId) return this.atlasUserId;

    const envId = process.env.ATLAS_USER_ID;
    if (envId) {
      this.atlasUserId = envId;
      return envId;
    }

    const user = await this.prisma.user.findFirst({
      where: { email: 'atlas@jbmidia.com.br' },
      select: { id: true },
    });

    if (user) {
      this.atlasUserId = user.id;
      this.logger.log(`[ATLAS] User ID resolvido: ${user.id}`);
    } else {
      this.logger.warn('[ATLAS] Usuário atlas@jbmidia.com.br não encontrado. Execute POST /dashboard/atlas/setup');
    }

    return this.atlasUserId;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleSync() {
    if (process.env.DISABLE_ATLAS_SYNC === 'true') return;

    const rawToken = process.env.ATLAS_DOM_TOKEN || process.env.DOM_TOKEN;
    if (!rawToken) {
      this.logger.warn('[ATLAS] Token não configurado (ATLAS_DOM_TOKEN) — sync ignorado');
      return;
    }
    const token = rawToken.trim();

    const userId = await this.resolveAtlasUserId();
    if (!userId) return;

    try {
      let created = 0;
      let updated = 0;
      let completedDelta = new Prisma.Decimal(0);

      for (let page = 1; page <= 3; page++) {
        const response = await this.gateway.listDomTransactions(token, {
          page,
          limit: 100,
          begin_date: dayjs().subtract(90, 'days').format('YYYY-MM-DD'),
          end_date: dayjs().format('YYYY-MM-DD'),
        });

        const txList = response.transactions || [];
        if (txList.length === 0) break;

        for (const tx of txList) {
          try {
            const description = ((tx as any).product_first || (tx as any).description || '').toLowerCase();
            if (!description.includes('atlas')) continue;

            const paymentId = tx.order_id || tx.id;
            const txId = tx.id;

            const existing = await this.prisma.transaction.findFirst({
              where: {
                OR: [
                  ...(paymentId ? [{ domPaymentId: String(paymentId) }] : []),
                  ...(txId ? [{ domTransactionId: String(txId) }] : []),
                ],
              },
            });

            const mappedStatus = this.mapStatus(tx.status);
            const amount      = new Prisma.Decimal(tx.amount || 0);
            const netAmount   = new Prisma.Decimal(tx.liquid_amount || Number(tx.amount || 0) * 0.91);
            const totalFee    = new Prisma.Decimal(tx.fee_total || 0);
            const domFee      = new Prisma.Decimal(tx.dom_fee || 0);
            const platformFee = totalFee.sub(domFee).lessThan(0) ? new Prisma.Decimal(0) : totalFee.sub(domFee);

            if (existing) {
              const needsUserFix = existing.userId !== userId;
              const needsStatusUpdate = existing.status !== mappedStatus;

              if (needsUserFix || needsStatusUpdate) {
                await this.prisma.transaction.update({
                  where: { id: existing.id },
                  data: {
                    ...(needsUserFix ? { userId } : {}),
                    status: mappedStatus,
                    previousStatus: existing.status,
                    amount,
                    netAmount,
                    totalFee,
                    domFee,
                    platformFee,
                    customerName:     tx.customer_name || existing.customerName,
                    customerEmail:    tx.customer_email || existing.customerEmail,
                    customerDocument: tx.customer_document || existing.customerDocument,
                    updatedAt: new Date(),
                  },
                });
                updated++;
                this.events.emitTransaction({ ...existing, status: mappedStatus });

                if (needsStatusUpdate) {
                  if (existing.status !== TransactionStatus.COMPLETED && mappedStatus === TransactionStatus.COMPLETED) {
                    completedDelta = completedDelta.add(amount);
                  }
                  if (existing.status === TransactionStatus.COMPLETED && mappedStatus !== TransactionStatus.COMPLETED) {
                    completedDelta = completedDelta.sub(new Prisma.Decimal(existing.amount ?? 0));
                  }
                }

                if (needsUserFix && mappedStatus === TransactionStatus.COMPLETED) {
                  completedDelta = completedDelta.add(amount);
                  this.logger.log(`[ATLAS] Tx ${existing.id} reassociada para userId=${userId}`);
                }
              }
              continue;
            }

            const newTx = await this.prisma.transaction.create({
              data: {
                userId,
                amount,
                netAmount,
                status: mappedStatus,
                paymentMethod: this.mapPaymentMethod(tx.payment_method),
                description: tx.product_first || 'atlas',
                domTransactionId: txId,
                domPaymentId:     paymentId,
                customerName:     tx.customer_name,
                customerEmail:    tx.customer_email,
                customerDocument: tx.customer_document,
                customerPhone:    tx.customer_phone,
                totalFee,
                domFee,
                platformFee,
                installments:     tx.installments || 1,
                createdAt:        tx.created_at ? new Date(tx.created_at) : new Date(),
                updatedAt:        tx.updated_at ? new Date(tx.updated_at) : (tx.created_at ? new Date(tx.created_at) : new Date()),
              },
            });

            created++;
            this.events.emitTransaction(newTx);

            if (mappedStatus === TransactionStatus.COMPLETED) {
              completedDelta = completedDelta.add(amount);
            }
          } catch (err: any) {
            if (err.code !== 'P2002') {
              this.logger.warn(`[ATLAS] Erro ao processar tx: ${err.message}`);
            }
          }
        }

        if (txList.length < 100) break;
      }

      if (created > 0 || updated > 0) {
        this.logger.log(`[ATLAS] Sync: ${created} criadas, ${updated} atualizadas`);

        if (!completedDelta.equals(0)) {
          const updatedWallet = await this.prisma.wallet.update({
            where: { userId },
            data: {
              balance: { increment: completedDelta },
              version: { increment: 1 },
            },
          });
          this.logger.log(`[ATLAS] Saldo ajustado em R$ ${completedDelta.toFixed(2)} (bruto)`);
          await this.syncExternalPlatformBalance(userId, Number(updatedWallet.balance));
        }
      }
    } catch (error: any) {
      this.logger.error(`[ATLAS] Sync error: ${error.message}`);
    }
  }

  async syncFull(): Promise<any> {
    const rawToken = process.env.ATLAS_DOM_TOKEN || process.env.DOM_TOKEN;
    if (!rawToken) {
      return { success: false, error: 'Token não configurado no .env (ATLAS_DOM_TOKEN)' };
    }
    const token = rawToken.trim();

    const userId = await this.resolveAtlasUserId();
    if (!userId) {
      return { success: false, error: 'Usuário Atlas não encontrado. Execute POST /dashboard/atlas/setup primeiro.' };
    }

    try {
      await this.gateway.listDomTransactions(token, {
        page: 1, limit: 1,
        begin_date: dayjs().subtract(1, 'month').format('YYYY-MM-DD'),
        end_date: dayjs().format('YYYY-MM-DD'),
      });
      this.logger.log(`[ATLAS] Conexão com DOM API v3 OK. Iniciando sync histórico...`);
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 401) return { success: false, error: 'Token inválido (401 Unauthorized)' };
      return { success: false, error: `Erro ao conectar na DOM API v3: HTTP ${status || err.message}` };
    }

    let totalSynced = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    let startRange = dayjs('2024-01-01');
    const now = dayjs();

    while (startRange.isBefore(now)) {
      let endRange = startRange.add(3, 'month');
      if (endRange.isAfter(now)) endRange = now;

      const beginStr = startRange.format('YYYY-MM-DD');
      const endStr = endRange.format('YYYY-MM-DD');

      this.logger.log(`[ATLAS] Sincronizando período: ${beginStr} a ${endStr}`);

      for (let page = 1; page <= 500; page++) {
        let response;
        try {
          response = await this.gateway.listDomTransactions(token, {
            page, limit: 100, begin_date: beginStr, end_date: endStr,
          });
        } catch (err: any) {
          this.logger.warn(`[ATLAS] Full sync: Erro na página ${page}: ${err.message}`);
          break;
        }

        const txList = response.transactions || [];
        if (txList.length === 0) break;

        const atlasTxs = txList.filter((tx: any) => {
          const desc = (tx.product_first || tx.description || '').toLowerCase();
          return desc.includes('atlas');
        });

        for (const tx of atlasTxs) {
          try {
            const paymentId = tx.order_id || tx.id;
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
            const netAmount   = new Prisma.Decimal(tx.liquid_amount || Number(tx.amount || 0) * 0.91);
            const totalFee    = new Prisma.Decimal(tx.fee_total || 0);
            const domFee      = new Prisma.Decimal(tx.dom_fee || 0);
            const platformFee = totalFee.sub(domFee).lessThan(0) ? new Prisma.Decimal(0) : totalFee.sub(domFee);

            if (existing) {
              const needsUserFix = existing.userId !== (this.atlasUserId || userId);
              await this.prisma.transaction.update({
                where: { id: existing.id },
                data: {
                  ...(needsUserFix ? { userId: this.atlasUserId || userId } : {}),
                  status: mappedStatus,
                  amount,
                  netAmount,
                  totalFee,
                  domFee,
                  platformFee,
                  description:      tx.product_first || existing.description,
                  customerName:     tx.customer_name || existing.customerName,
                  customerEmail:    tx.customer_email || existing.customerEmail,
                  customerDocument: tx.customer_document || existing.customerDocument,
                  customerPhone:    tx.customer_phone || existing.customerPhone,
                  updatedAt: new Date(),
                },
              });
              totalUpdated++;
              continue;
            }

            await this.prisma.transaction.create({
              data: {
                userId: this.atlasUserId || userId,
                amount,
                netAmount,
                status: mappedStatus,
                paymentMethod: this.mapPaymentMethod(tx.payment_method),
                description: tx.product_first || 'atlas',
                domTransactionId: txId,
                domPaymentId:     paymentId,
                customerName:     tx.customer_name,
                customerEmail:    tx.customer_email,
                customerDocument: tx.customer_document,
                customerPhone:    tx.customer_phone,
                totalFee,
                domFee,
                platformFee,
                installments:     tx.installments || 1,
                createdAt:        tx.created_at ? new Date(tx.created_at) : new Date(),
                updatedAt:        tx.updated_at ? new Date(tx.updated_at) : (tx.created_at ? new Date(tx.created_at) : new Date()),
              },
            });
            totalSynced++;
          } catch (err: any) {
            totalErrors++;
            if (totalErrors <= 5) this.logger.warn(`[ATLAS] Erro ao processar tx ${tx.id}: ${err.message}`);
          }
        }

        if (txList.length < 100) break;
      }

      startRange = endRange.add(1, 'day');
    }

    // Recalcula saldo do zero
    const completedAgg = await this.prisma.transaction.aggregate({
      where: { userId, status: TransactionStatus.COMPLETED },
      _sum: { netAmount: true },
    });

    const withdrawalsAgg = await this.prisma.withdrawRequest.aggregate({
      where: { userId, status: { in: ['APPROVED', 'COMPLETED'] as any } },
      _sum: { amount: true },
    });

    const totalReceived = Number(completedAgg._sum.netAmount ?? 0);
    const totalWithdrawn = Number(withdrawalsAgg._sum.amount ?? 0);
    const newBalance = Math.max(0, totalReceived - totalWithdrawn);

    await this.prisma.wallet.update({
      where: { userId },
      data: { balance: new Prisma.Decimal(newBalance), version: { increment: 1 } },
    });
    await this.syncExternalPlatformBalance(userId, newBalance);

    const totalInDatabase = await this.prisma.transaction.count({ where: { userId } });

    this.logger.log(`[ATLAS] Full sync concluído: ${totalSynced} criadas, ${totalUpdated} atualizadas, ${totalErrors} erros`);
    this.logger.log(`[ATLAS] Saldo recalculado: R$ ${newBalance.toFixed(2)}`);

    return {
      success: true,
      message: 'Sincronização completa realizada com sucesso',
      totalSynced,
      totalUpdated,
      totalErrors,
      totalInDatabase,
      balance: newBalance,
      totalReceived,
      totalWithdrawn,
    };
  }

  async setWalletBalance(netBalanceParam: number): Promise<any> {
    const userId = await this.resolveAtlasUserId();
    if (!userId) return { success: false, error: 'Usuário Atlas não encontrado.' };

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return { success: false, error: 'Wallet não encontrada.' };

    const oldBalance = Number(wallet.balance || 0);
    const fatorLiquidez = getPlatformTaxaEffective('ATLAS', 'LIQUIDEZ', 0.91);
    const netBalance = Number(netBalanceParam);
    const grossBalance = netBalance / fatorLiquidez;

    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId },
        data: { balance: new Prisma.Decimal(grossBalance), version: { increment: 1 } },
      }),
      this.prisma.balanceLog.create({
        data: {
          userId,
          action: 'WALLET_RECALCULATE',
          amount: grossBalance - oldBalance,
          balanceBefore: oldBalance,
          balanceAfter: grossBalance,
          lockedBefore: wallet.lockedBalance,
          lockedAfter: wallet.lockedBalance,
          description: `Saldo base Atlas definido manualmente. netBalance: R$ ${netBalance.toFixed(2)}, bruto: R$ ${grossBalance.toFixed(2)}`,
          source: 'ADMIN_SYNC',
          metadata: { oldBalance, netBalance, grossBalance, fatorLiquidez, setManually: true },
        },
      }),
    ]);

    this.logger.log(`[ATLAS] Saldo definido manualmente: Net=R$ ${netBalance.toFixed(2)}, Bruto=R$ ${grossBalance.toFixed(2)}`);
    return {
      success: true,
      message: 'Saldo definido com sucesso (lógica de liquidez aplicada)',
      netBalance,
      grossBalance,
      userId,
    };
  }

  async zeroWallet(): Promise<any> {
    const userId = await this.resolveAtlasUserId();
    if (!userId) {
      return { success: false, error: 'ATLAS_USER_ID não configurado ou usuário Atlas não encontrado.' };
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      return { success: false, error: 'Wallet não encontrada para o usuário Atlas.' };
    }

    const oldBalance = Number(wallet.balance || 0);
    const oldLocked = Number(wallet.lockedBalance || 0);

    if (oldBalance === 0 && oldLocked === 0) {
      await this.syncExternalPlatformBalance(userId, 0);
      return { success: true, userId, balanceBefore: 0, lockedBefore: 0, alreadyZero: true };
    }

    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId },
        data: {
          balance: new Prisma.Decimal(0),
          lockedBalance: new Prisma.Decimal(0),
          version: { increment: 1 },
        },
      }),
      this.prisma.balanceLog.create({
        data: {
          userId,
          action: 'ATLAS_WALLET_ZERO',
          amount: new Prisma.Decimal(-oldBalance),
          balanceBefore: oldBalance,
          balanceAfter: 0,
          lockedBefore: oldLocked,
          lockedAfter: 0,
          description: `Carteira Atlas zerada (admin). Saldo bruto antes: R$ ${oldBalance.toFixed(2)}, bloqueado: R$ ${oldLocked.toFixed(2)}`,
          source: 'ADMIN_SYNC',
          metadata: { oldBalance, oldLocked, userId },
        },
      }),
    ]);

    await this.syncExternalPlatformBalance(userId, 0);
    this.logger.warn(`[ATLAS] Carteira zerada para userId=${userId}`);

    return { success: true, userId, balanceBefore: oldBalance, lockedBefore: oldLocked };
  }

  private async syncExternalPlatformBalance(userId: string, balance: number): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, cpf: true },
      });
      if (!user) return;

      const cpf = user.cpf ?? userId.replace(/-/g, '').slice(0, 11).padEnd(11, '0');

      const extUser = await this.prisma.externalPlatformUser.upsert({
        where: { cpf_platform: { cpf, platform: 'atlas' } },
        update: { name: user.name, userId: user.id },
        create: { cpf, name: user.name, platform: 'atlas', userId: user.id },
      });

      await this.prisma.externalPlatformWallet.upsert({
        where: { externalUserId: extUser.id },
        update: { balance },
        create: { externalUserId: extUser.id, balance },
      });
    } catch (err: any) {
      this.logger.warn(`[ATLAS] Falha ao sincronizar ExternalPlatformWallet: ${err.message}`);
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
