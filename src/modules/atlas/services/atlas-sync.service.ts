import { PlatformMaintenanceService } from '../../unified-platform/finance/platform-maintenance.service';
import { requireExclusivePlatformWallet } from '../../../application/helpers/exclusive-platform-wallet.helper';
import { PlatformSyncPersistenceService } from '../../platform-core/platform-sync-persistence.service';
import { getPlatformIntegrationValue } from '../../platform-integrations/platform-integrations.store';
import { TransactionStatus, PaymentMethod, Prisma } from '@prisma/client';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

  constructor(
    private readonly syncCore: PlatformSyncPersistenceService,
    private readonly prisma: PrismaService,
    private readonly events: AtlasEventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async onModuleInit() {
    const enabled = getPlatformIntegrationValue('ATLAS', 'ENABLE_DOM_SYNC') === 'true';
    this.logger.log(
      `[ATLAS] Sync service initialized (DOM API v3 mode; ${enabled ? 'enabled' : 'disabled'})`,
    );
  }

  private async resolveAtlasUserId(): Promise<string | null> {
    try {
      const platform = await this.prisma.platform.findFirst({
        where: { tag: { equals: 'atlas', mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false } },
      });
      return platform?.ownerUserId ?? null;
    } catch (error) {
      this.logger.error('Banco indisponível ao resolver dono da plataforma.', error);
      return null;
    }
  }

  async handleSync() { return this.syncCore.poll('ATLAS'); }

  async syncFull(): Promise<any> {
    const rawToken = getPlatformIntegrationValue('ATLAS', 'DOM_TOKEN');
    if (!rawToken) {
      return { success: false, error: 'Token não configurado no admin (ATLAS_DOM_TOKEN)' };
    }
    const token = rawToken.trim();

    const userId = await this.resolveAtlasUserId();
    if (!userId) {
      return { success: false, error: 'Plataforma sem dono cadastrado no admin.' };
    }

    await requireExclusivePlatformWallet(this.prisma, userId, 'ATLAS');

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
              totalUpdated++;
              continue;
            }

            await this.prisma.transaction.create({
              data: {
                userId: userId,
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

    await new PlatformMaintenanceService(this.prisma).correct(userId, 'ATLAS', { balance: newBalance, action: 'WALLET_RECALCULATE', source: 'ADMIN_SYNC', reason: 'Reconciliação do histórico após sincronização completa' });
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

    await requireExclusivePlatformWallet(this.prisma, userId, 'ATLAS');

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return { success: false, error: 'Wallet não encontrada.' };

    const oldBalance = Number(wallet.balance || 0);
    const fatorLiquidez = getPlatformTaxaEffective('ATLAS', 'LIQUIDEZ', 0.91);
    const netBalance = Number(netBalanceParam);
    const grossBalance = netBalance / fatorLiquidez;

    await new PlatformMaintenanceService(this.prisma).correct(userId, 'ATLAS', { balance: grossBalance, action: 'WALLET_RECALCULATE', source: 'ADMIN_SYNC', reason: 'Saldo definido manualmente com liquidez' });

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
      return { success: false, error: 'Plataforma sem dono cadastrado no admin.' };
    }

    await requireExclusivePlatformWallet(this.prisma, userId, 'ATLAS');

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

    await new PlatformMaintenanceService(this.prisma).correct(userId, 'ATLAS', { balance: 0, lockedBalance: 0, action: 'ATLAS_WALLET_ZERO', source: 'ADMIN_SYNC' });

    await this.syncExternalPlatformBalance(userId, 0);
    this.logger.warn(`[ATLAS] Carteira zerada para userId=${userId}`);

    return { success: true, userId, balanceBefore: oldBalance, lockedBefore: oldLocked };
  }

  private async syncExternalPlatformBalance(userId: string, balance: number): Promise<void> {
    try {
      const platform = await this.prisma.platform.findFirst({
        where: { tag: { equals: 'atlas', mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false }, ownerUserId: userId },
      });
      if (!platform) return;

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
