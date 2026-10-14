import { requireExclusivePlatformWallet } from '../../../application/helpers/exclusive-platform-wallet.helper';
import { PlatformSyncPersistenceService } from '../../platform-core/platform-sync-persistence.service';
import { getPlatformIntegrationValue } from '../../platform-integrations/platform-integrations.store';
import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

  private readonly DOM_API_URL = 'https://apiv3.dompagamentos.com.br/checkout/production';

  constructor(
    private readonly syncCore: PlatformSyncPersistenceService,
    private readonly prisma: PrismaService,
    private readonly events: RevalidaEventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async onModuleInit() {
    const enabled = getPlatformIntegrationValue('REVALIDA', 'ENABLE_DOM_SYNC') === 'true';
    this.logger.log(
      `[REVALIDA] Sync service initialized (DOM API v3 mode; ${enabled ? 'enabled' : 'disabled'})`,
    );
  }

  private async resolveRevalidaUserId(): Promise<string | null> {
    try {
      const platform = await this.prisma.platform.findFirst({
        where: { tag: { equals: 'revalida', mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false } },
      });
      return platform?.ownerUserId ?? null;
    } catch (error) {
      this.logger.error('Banco indisponível ao resolver dono da plataforma.', error);
      return null;
    }
  }

  async handleSync() { return this.syncCore.poll('REVALIDA'); }

  /**
   * Sincronização completa do histórico — percorre todos os registros da DOM API v3,
   * filtra pelo nome "revalida", cria/atualiza no banco e recalcula o saldo da carteira do zero.
   */
  async syncFull(): Promise<any> {
    const rawToken = getPlatformIntegrationValue('REVALIDA', 'DOM_TOKEN');
    if (!rawToken) {
      return { success: false, error: 'Token não configurado no admin (REVALIDA_DOM_TOKEN ou DOM_TOKEN)' };
    }
    const token = rawToken.trim();

    const userId = await this.resolveRevalidaUserId();
    if (!userId) {
      return { success: false, error: 'Plataforma sem dono cadastrado no admin.' };
    }

    // Teste de conexão (usa um intervalo pequeno para garantir sucesso)
    await requireExclusivePlatformWallet(this.prisma, userId, 'REVALIDA');

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
              if (existing.userId !== userId) continue;
              const needsUserFix = existing.userId !== (userId);
              await this.prisma.transaction.update({
                where: { id: existing.id },
                data: {
                  ...(needsUserFix ? { userId: userId } : {}),
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
                userId:           userId, // Use detected ID
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

    await requireExclusivePlatformWallet(this.prisma, userId, 'REVALIDA');

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
      return { success: false, error: 'Plataforma sem dono cadastrado no admin.' };
    }

    await requireExclusivePlatformWallet(this.prisma, userId, 'REVALIDA');

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
      const platform = await this.prisma.platform.findFirst({
        where: { tag: { equals: 'revalida', mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false }, ownerUserId: userId },
      });
      if (!platform) return;

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
