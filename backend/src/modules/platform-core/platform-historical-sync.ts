import type { PlatformContext } from './platform-context.service';
import { ConflictException } from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';
import { requireExclusivePlatformWallet } from '../../application/helpers/exclusive-platform-wallet.helper';
import { PlatformMaintenanceService } from '../unified-platform/finance/platform-maintenance.service';
import { PlatformOwnerMirror } from './platform-owner-mirror';
import { acceptsPlatformSyncDescription } from './platform-sync.adapter';
import { unsupportedCapability } from './platform-adapters';

type HistoricalPlatform = { id: string; tag: string; ownerUserId: string };
export class PlatformHistoricalSync {
  constructor(private readonly prisma: PrismaService, private readonly gateway: IPaymentGateway,
    private readonly persist: (platform: HistoricalPlatform, row: any, description: string) => Promise<boolean>) {}

  async run(tag: string, context?: PlatformContext) {
    if (!['ATLAS', 'REVALIDA'].includes(tag)) unsupportedCapability('sync.history');
    const token = getPlatformIntegrationValue(tag, 'DOM_TOKEN')?.trim();
    if (!token) return { success: false, error: tag === 'ATLAS' ? 'Token não configurado no admin (ATLAS_DOM_TOKEN)' : 'Token não configurado no admin (REVALIDA_DOM_TOKEN ou DOM_TOKEN)' };
    const platform = await this.prisma.platform.findUnique({ where: { tag }, include: { owner: true } });
    if (!platform?.isActive || !platform.owner.isActive || platform.owner.isPurged) return { success: false, error: 'Plataforma sem dono cadastrado no admin.' };
    if (context && (context.id !== platform.id || context.ownerUserId !== platform.ownerUserId || context.acquirer !== platform.acquirer)) throw new ConflictException('Contexto da plataforma mudou');
    if (platform.acquirer !== 'DOM') unsupportedCapability('sync.history.' + platform.acquirer);
    await requireExclusivePlatformWallet(this.prisma, platform.ownerUserId, tag);
    try {
      await this.gateway.listDomTransactions(token, { page: 1, limit: 1, begin_date: dayjs().subtract(1, 'month').format('YYYY-MM-DD'), end_date: dayjs().format('YYYY-MM-DD') });
    } catch (error) {
      const e = error as { response?: { status?: number }; message?: string };
      return { success: false, error: e.response?.status === 401 ? 'Token inválido (401 Unauthorized)' : `Erro ao conectar na DOM API v3: HTTP ${e.response?.status || e.message}` };
    }
    let totalSynced = 0, totalUpdated = 0, totalErrors = 0, totalSkipped = 0;
    let start = dayjs('2024-01-01');
    const now = dayjs();
    while (start.isBefore(now)) {
      const end = start.add(3, 'month').isAfter(now) ? now : start.add(3, 'month');
      for (let page = 1; page <= 500; page++) {
        let rows: any[];
        try { rows = (await this.gateway.listDomTransactions(token, { page, limit: 100, begin_date: start.format('YYYY-MM-DD'), end_date: end.format('YYYY-MM-DD') })).transactions ?? []; }
        catch { totalErrors++; break; }
        for (const row of rows) {
          const description = String(row.product_first ?? row.description ?? '');
          if (!acceptsPlatformSyncDescription(description, tag)) continue;
          try {
            const paymentId = String(row.order_id ?? row.id ?? '');
            if (!paymentId) { totalSkipped++; continue; }
            const existing = await this.prisma.transaction.findFirst({ where: { OR: [{ domPaymentId: paymentId }, ...(row.id == null ? [] : [{ domTransactionId: String(row.id) }])] } });
            const changed = await this.persist(platform, row, description);
            if (!changed) totalSkipped++;
            else if (existing) totalUpdated++;
            else totalSynced++;
          } catch { totalErrors++; }
        }
        if (rows.length < 100) break;
      }
      start = end.add(1, 'day');
    }
    // Legacy full-sync is an explicit exclusive-wallet maintenance operation.
    // Its owner-level aggregates preserve historical entries without assigning them a product tag.
    const userId = platform.ownerUserId;
    const [completed, withdrawals, totalInDatabase] = await Promise.all([
      this.prisma.transaction.aggregate({ where: { userId, status: 'COMPLETED' }, _sum: { netAmount: true } }),
      this.prisma.withdrawRequest.aggregate({ where: { userId, status: { in: ['APPROVED', 'COMPLETED'] } }, _sum: { amount: true } }),
      this.prisma.transaction.count({ where: { userId } }),
    ]);
    const totalReceived = Number(completed._sum.netAmount ?? 0), totalWithdrawn = Number(withdrawals._sum.amount ?? 0);
    const balance = Math.max(0, totalReceived - totalWithdrawn);
    await new PlatformMaintenanceService(this.prisma).correct(userId, tag, { balance, action: 'WALLET_RECALCULATE', source: 'ADMIN_SYNC', reason: 'Reconciliação do histórico após sincronização completa' }, { id: platform.id, tag, ownerUserId: userId, acquirer: platform.acquirer });
    await new PlatformOwnerMirror(this.prisma).sync(tag, { id: platform.id, tag, ownerUserId: userId, acquirer: platform.acquirer });
    return { success: true, message: 'Sincronização completa realizada com sucesso', totalSynced, totalUpdated, totalErrors,
      ...(tag === 'REVALIDA' ? { totalSkipped } : {}), totalInDatabase, balance, totalReceived, totalWithdrawn };
  }
}
