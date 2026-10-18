import { PlatformOwnerMirror } from '../../platform-core/platform-owner-mirror';
import { PlatformMaintenanceService } from '../../unified-platform/finance/platform-maintenance.service';
import { requireExclusivePlatformWallet } from '../../../application/helpers/exclusive-platform-wallet.helper';
import { PlatformSyncPersistenceService } from '../../platform-core/platform-sync-persistence.service';
import { getPlatformIntegrationValue } from '../../platform-integrations/platform-integrations.store';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { AtlasEventsService } from '../events/atlas-events.service';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
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

  async syncFull(): Promise<any> { return this.syncCore.history('ATLAS'); }

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

    const result = await new PlatformMaintenanceService(this.prisma).correct(userId, 'ATLAS', { balance: 0, lockedBalance: 0, action: 'ATLAS_WALLET_ZERO', source: 'ADMIN_SYNC' });

    await this.syncExternalPlatformBalance(userId, 0);
    if (result.changed) this.logger.warn(`[ATLAS] Carteira zerada para userId=${userId}`);
    return {
      success: true,
      userId,
      balanceBefore: result.balanceBefore,
      lockedBefore: result.lockedBefore,
      ...(!result.changed ? { alreadyZero: true as const } : {}),
    };
  }

  private async syncExternalPlatformBalance(userId: string, _balance: number): Promise<void> {
    try {
      const platform = await this.prisma.platform.findUnique({ where: { tag: 'ATLAS' } });
      if (platform?.ownerUserId !== userId) return;
      await new PlatformOwnerMirror(this.prisma).sync('ATLAS', { id: platform.id, tag: platform.tag, ownerUserId: userId, acquirer: platform.acquirer });
    } catch { this.logger.warn('[ATLAS] Falha ao sincronizar ExternalPlatformWallet'); }
  }
}
