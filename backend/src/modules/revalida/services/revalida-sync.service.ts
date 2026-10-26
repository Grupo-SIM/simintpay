import { PlatformOwnerMirror } from '../../platform-core/platform-owner-mirror';
import { PlatformMaintenanceService } from '../../unified-platform/finance/platform-maintenance.service';
import { requireExclusivePlatformWallet } from '../../../application/helpers/exclusive-platform-wallet.helper';
import { PlatformSyncPersistenceService } from '../../platform-core/platform-sync-persistence.service';
import { getPlatformIntegrationValue } from '../../platform-integrations/platform-integrations.store';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RevalidaEventsService } from '../events/revalida-events.service';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
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
  async syncFull(): Promise<any> { return this.syncCore.history('REVALIDA'); }

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

    await new PlatformMaintenanceService(this.prisma).correct(userId, 'REVALIDA', { balance: grossBalance, action: 'WALLET_RECALCULATE', source: 'ADMIN_SYNC', reason: 'Saldo definido manualmente com liquidez' });

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

    const result = await new PlatformMaintenanceService(this.prisma).correct(userId, 'REVALIDA', { balance: 0, lockedBalance: 0, action: 'REVALIDA_WALLET_ZERO', source: 'ADMIN_SYNC' });

    await this.syncExternalPlatformBalance(userId, 0);
    if (result.changed) this.logger.warn(`[REVALIDA] Carteira zerada para userId=${userId}`);
    return {
      success: true,
      userId,
      balanceBefore: result.balanceBefore,
      lockedBefore: result.lockedBefore,
      ...(!result.changed ? { alreadyZero: true as const } : {}),
    };
  }

  /**
   * Mantém a ExternalPlatformWallet do usuário Revalida sincronizada com a Wallet real.
   * Se o registro ainda não existir em ExternalPlatformUser, cria automaticamente.
   */
  private async syncExternalPlatformBalance(userId: string, _balance: number): Promise<void> {
    try {
      const platform = await this.prisma.platform.findUnique({ where: { tag: 'REVALIDA' } });
      if (platform?.ownerUserId !== userId) return;
      await new PlatformOwnerMirror(this.prisma).sync('REVALIDA', { id: platform.id, tag: platform.tag, ownerUserId: userId, acquirer: platform.acquirer });
    } catch { this.logger.warn('[REVALIDA] Falha ao sincronizar ExternalPlatformWallet'); }
  }
}
