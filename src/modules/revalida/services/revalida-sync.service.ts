import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RevalidaEventsService } from '../events/revalida-events.service';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import dayjs from 'dayjs';
import { getPlatformTaxaEffective } from '../../platform-taxas/platform-taxas.store';

/**
 * RevalidaSyncService — Sincroniza transações do Revalida a partir da API v3 da DOM.
 *
 * IMPORTANTE: Usa a DOM API v3 DIRETAMENTE (never api-dom.jbmidia.com).
 * Autenticação: Authorization Bearer {REVALIDA_DOM_TOKEN}
 * Base URL: https://apiv3.dompagamentos.com.br/checkout/production
 */
@Injectable()
export class RevalidaSyncService implements OnModuleInit {
  private readonly logger = new Logger(RevalidaSyncService.name);
  private revalidaUserId: string | null = null;

  private readonly DOM_API_URL = 'https://apiv3.dompagamentos.com.br/checkout/production';

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RevalidaEventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async onModuleInit() {
    const enabled = process.env.ENABLE_REVALIDA_DOM_SYNC === 'true';
    this.logger.log(
      `[REVALIDA] Sync service initialized (DOM API v3 mode; ${enabled ? 'enabled' : 'disabled'})`,
    );
  }

  private async resolveRevalidaUserId(): Promise<string | null> {
    if (this.revalidaUserId) return this.revalidaUserId;

    const envId = process.env.REVALIDA_USER_ID;
    if (envId) {
      this.revalidaUserId = envId;
      return envId;
    }

    let user: { id: string } | null;
    try {
      user = await this.prisma.user.findFirst({
        where: { email: 'revalida@jbmidia.com.br' },
        select: { id: true },
      });
    } catch (error) {
      this.logger.error('[REVALIDA] Banco indisponível ao resolver usuário; nova tentativa no próximo ciclo.', error);
      return null;
    }

    if (user) {
      this.revalidaUserId = user.id;
      this.logger.log(`[REVALIDA] User ID resolvido: ${user.id}`);
    } else {
      this.logger.warn('[REVALIDA] Usuário revalida@jbmidia.com.br não encontrado. Execute POST /admin/revalida/setup');
    }

    return this.revalidaUserId;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleSync() {
    if (process.env.ENABLE_REVALIDA_DOM_SYNC !== 'true') return;

    const rawToken = process.env.REVALIDA_DOM_TOKEN || process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!rawToken) {
      this.logger.warn('[REVALIDA] Token não configurado (REVALIDA_DOM_TOKEN ou DOM_TOKEN) — sync ignorado');
      return;
    }
    const token = rawToken.trim();

    try {
      const userId = await this.resolveRevalidaUserId();
      if (!userId) return;
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
            // No DOM v3 direto, a descrição pode vir em product_first ou description
            const description = ((tx as any).product_first || (tx as any).description || '').toLowerCase();
            if (!description.includes('revalida')) continue;

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
                  this.logger.log(`[REVALIDA] Tx ${existing.id} reassociada de userId=${existing.userId} para userId=${userId}`);
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
                description: tx.product_first || 'Sincronização Revalida',
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
              this.logger.warn(`[REVALIDA] Erro ao processar tx: ${err.message}`);
            }
          }
        }

        if (txList.length < 100) break;
      }

      if (created > 0 || updated > 0) {
        this.logger.log(`[REVALIDA] Sync: ${created} criadas, ${updated} atualizadas`);

        if (!completedDelta.equals(0)) {
          const updatedWallet = await this.prisma.wallet.update({
            where: { userId },
            data: {
              balance: { increment: completedDelta },
              version: { increment: 1 },
            },
          });
          this.logger.log(`[REVALIDA] Saldo ajustado em R$ ${completedDelta.toFixed(2)} (bruto)`);
          await this.syncExternalPlatformBalance(userId, Number(updatedWallet.balance));
        }
      }
    } catch (error: any) {
      this.logger.error(`[REVALIDA] Sync error: ${error.message}`);
    }
  }

  /**
   * Sincronização completa do histórico — percorre todos os registros da DOM API v3,
   * filtra pelo nome "revalida", cria/atualiza no banco e recalcula o saldo da carteira do zero.
   */
  async syncFull(): Promise<any> {
    const rawToken = process.env.REVALIDA_DOM_TOKEN || process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!rawToken) {
      return { success: false, error: 'Token não configurado no .env (REVALIDA_DOM_TOKEN ou DOM_TOKEN)' };
    }
    const token = rawToken.trim();

    const userId = await this.resolveRevalidaUserId();
    if (!userId) {
      return { success: false, error: 'Usuário revalida não encontrado. Execute POST /dashboard/revalida/setup primeiro.' };
    }

    // Teste de conexão (usa um intervalo pequeno para garantir sucesso)
    try {
      await this.gateway.listDomTransactions(token, {
        page: 1, limit: 1, 
        begin_date: dayjs().subtract(1, 'month').format('YYYY-MM-DD'), 
        end_date: dayjs().format('YYYY-MM-DD')
      });
      this.logger.log(`[REVALIDA] Conexão com DOM API v3 OK. Iniciando sync histórico...`);
    } catch (err: any) {
      const status = err.response?.status;
      const errorData = JSON.stringify(err.response?.data || {});
      this.logger.error(`[REVALIDA] Falha no teste de conexão: HTTP ${status} - Data: ${errorData}`);
      if (status === 401) return { success: false, error: 'Token inválido (401 Unauthorized)' };
      return { success: false, error: `Erro ao conectar na DOM API v3: HTTP ${status || err.message}` };
    }

    let totalSynced = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    let totalSkipped = 0;

    // A API v3 tem limite de 3 meses por intervalo.
    // Vamos iterar de 3 em 3 meses desde 01/01/2024 até hoje.
    let startRange = dayjs('2024-01-01');
    const now = dayjs();

    while (startRange.isBefore(now)) {
      let endRange = startRange.add(3, 'month');
      if (endRange.isAfter(now)) endRange = now;

      const beginStr = startRange.format('YYYY-MM-DD');
      const endStr = endRange.format('YYYY-MM-DD');

      this.logger.log(`[REVALIDA] Sincronizando período: ${beginStr} a ${endStr}`);

      for (let page = 1; page <= 500; page++) {
        let response;
        try {
          response = await this.gateway.listDomTransactions(token, {
            page,
            limit: 100,
            begin_date: beginStr,
            end_date: endStr,
          });
        } catch (err: any) {
          this.logger.warn(`[REVALIDA] Full sync: Erro na página ${page} (${beginStr} a ${endStr}): ${err.message}`);
          break;
        }

        const txList = response.transactions || [];
        if (txList.length === 0) break;

        const revalidaTxs = txList.filter((tx: any) => {
          const description = (tx.product_first || tx.description || '').toLowerCase();
          return description.includes('revalida');
        });

        for (const tx of revalidaTxs) {
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
              const needsUserFix = existing.userId !== (this.revalidaUserId || userId);
              await this.prisma.transaction.update({
                where: { id: existing.id },
                data: {
                  ...(needsUserFix ? { userId: this.revalidaUserId || userId } : {}),
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
              if (needsUserFix) {
                this.logger.log(`[REVALIDA] syncFull: Tx ${existing.id} reassociada de userId=${existing.userId} para Revalida`);
              }
              totalUpdated++;
              continue;
            }

            await this.prisma.transaction.create({
              data: {
                userId:           this.revalidaUserId || userId, // Use detected ID
                amount,
                netAmount,
                status:           mappedStatus,
                paymentMethod:    this.mapPaymentMethod(tx.payment_method),
                description:      tx.product_first || 'Sincronização Revalida',
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
            if (totalErrors <= 5) this.logger.warn(`[REVALIDA] Erro ao processar tx ${tx.id}: ${err.message}`);
          }
        }

        if (txList.length < 100) break;
      }

      startRange = endRange.add(1, 'day'); // Pula para o próximo dia para evitar overlap se a API incluir os limites
    }

    // Recalcula saldo do zero com base em todas as transações concluídas menos saques aprovados
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

    this.logger.log(`[REVALIDA] Full sync concluído: ${totalSynced} criadas, ${totalUpdated} atualizadas, ${totalSkipped} ignoradas, ${totalErrors} erros`);
    this.logger.log(`[REVALIDA] Saldo recalculado: R$ ${newBalance.toFixed(2)} (recebido: R$ ${totalReceived.toFixed(2)}, sacado: R$ ${totalWithdrawn.toFixed(2)})`);

    return {
      success: true,
      message: 'Sincronização completa realizada com sucesso',
      totalSynced,
      totalUpdated,
      totalSkipped,
      totalErrors,
      totalInDatabase,
      balance: newBalance,
      totalReceived,
      totalWithdrawn,
    };
  }

  /**
   * Sobrescreve o saldo da carteira manualmente (conforme lógica da Renovada/Bosque).
   * O valor informado é o saldo LÍQUIDO desejado (o que o usuário vê),
   * mas no banco armazenamos o BRUTO (valor / liquidez).
   */
  async setWalletBalance(netBalanceParam: number): Promise<any> {
    const userId = await this.resolveRevalidaUserId();
    if (!userId) return { success: false, error: 'Usuário revalida não encontrado.' };

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return { success: false, error: 'Wallet não encontrada.' };

    const oldBalance = Number(wallet.balance || 0);
    const fatorLiquidez = getPlatformTaxaEffective('REVALIDA', 'LIQUIDEZ', 0.91);
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
          description: `Saldo base Revalida definido manualmente. netBalance: R$ ${netBalance.toFixed(2)}, bruto: R$ ${grossBalance.toFixed(2)}`,
          source: 'ADMIN_SYNC',
          metadata: { oldBalance, netBalance, grossBalance, fatorLiquidez, setManually: true },
        },
      }),
    ]);

    this.logger.log(`[REVALIDA] Saldo definido manualmente: Net=R$ ${netBalance.toFixed(2)}, Bruto=R$ ${grossBalance.toFixed(2)}`);
    return {
      success: true,
      message: 'Saldo definido com sucesso (lógica de liquidez aplicada)',
      netBalance,
      grossBalance,
      userId
    };
  }

  /**
   * Zera balance e lockedBalance da carteira do usuário Revalida (REVALIDA_USER_ID no .env).
   * Registra BalanceLog e sincroniza ExternalPlatformWallet com 0.
   */
  async zeroWallet(): Promise<{
    success: boolean;
    error?: string;
    userId?: string;
    balanceBefore?: number;
    lockedBefore?: number;
    alreadyZero?: boolean;
  }> {
    const userId = await this.resolveRevalidaUserId();
    if (!userId) {
      return { success: false, error: 'REVALIDA_USER_ID não configurado ou usuário revalida não encontrado.' };
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      return { success: false, error: 'Wallet não encontrada para o usuário Revalida.' };
    }

    const oldBalance = Number(wallet.balance || 0);
    const oldLocked = Number(wallet.lockedBalance || 0);

    if (oldBalance === 0 && oldLocked === 0) {
      await this.syncExternalPlatformBalance(userId, 0);
      return {
        success: true,
        userId,
        balanceBefore: 0,
        lockedBefore: 0,
        alreadyZero: true as const,
      };
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
          action: 'REVALIDA_WALLET_ZERO',
          amount: new Prisma.Decimal(-oldBalance),
          balanceBefore: oldBalance,
          balanceAfter: 0,
          lockedBefore: oldLocked,
          lockedAfter: 0,
          description: `Carteira Revalida zerada (admin). Saldo bruto antes: R$ ${oldBalance.toFixed(2)}, bloqueado: R$ ${oldLocked.toFixed(2)}`,
          source: 'ADMIN_SYNC',
          metadata: { oldBalance, oldLocked, userId },
        },
      }),
    ]);

    await this.syncExternalPlatformBalance(userId, 0);
    this.logger.warn(`[REVALIDA] Carteira zerada para userId=${userId} (balance era ${oldBalance}, locked ${oldLocked})`);

    return {
      success: true,
      userId,
      balanceBefore: oldBalance,
      lockedBefore: oldLocked,
    };
  }

  /**
   * Mantém a ExternalPlatformWallet do usuário Revalida sincronizada com a Wallet real.
   * Se o registro ainda não existir em ExternalPlatformUser, cria automaticamente.
   */
  private async syncExternalPlatformBalance(userId: string, balance: number): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, cpf: true },
      });
      if (!user) return;

      const cpf = user.cpf ?? userId.replace(/-/g, '').slice(0, 11).padEnd(11, '0');

      const extUser = await this.prisma.externalPlatformUser.upsert({
        where: { cpf_platform: { cpf, platform: 'revalida' } },
        update: { name: user.name, userId: user.id },
        create: { cpf, name: user.name, platform: 'revalida', userId: user.id },
      });

      await this.prisma.externalPlatformWallet.upsert({
        where: { externalUserId: extUser.id },
        update: { balance },
        create: { externalUserId: extUser.id, balance },
      });
    } catch (err: any) {
      this.logger.warn(`[REVALIDA] Falha ao sincronizar ExternalPlatformWallet: ${err.message}`);
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
