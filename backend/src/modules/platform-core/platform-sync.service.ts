import { whereTransactionPlatform } from './transaction-platform';
import { syncStatus } from './platform-sync.adapter';
import { applyWalletEntry } from '../wallet-ledger/wallet-ledger';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  PAYMENT_GATEWAY,
  type IPaymentGateway,
} from '../../core/services/payment-gateway.interface';
import {
  PlatformContextService,
  type PlatformContext,
} from './platform-context.service';
import { PlatformEventsService } from './platform-events.service';
import { unsupportedCapability } from './platform-adapters';
import { AtlasSyncService } from '../atlas/services/atlas-sync.service';
import { BosqueSyncService } from '../bosque/services/bosque-sync.service';
import { RenovadaSyncService } from '../renovada/services/renovada-sync.service';
import { RevalidaSyncService } from '../revalida/services/revalida-sync.service';

const corporateSync = {
  ATLAS: AtlasSyncService,
  BOSQUE: BosqueSyncService,
  RENOVADA: RenovadaSyncService,
  REVALIDA: RevalidaSyncService,
};

@Injectable()
export class PlatformSyncService {
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly logger = new Logger(PlatformSyncService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: PlatformContextService,
    private readonly modules: ModuleRef,
    private readonly events: PlatformEventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduled() {
    const platforms = await this.prisma.platform.findMany({
      where: {
        isActive: true,
        owner: { isActive: true, isPurged: false },
        integrations: {
          some: { key: 'ENABLE_DOM_SYNC' },
        },
      },
      include: { integrations: true },
    });
    for (const platform of platforms) {
      if (
        !platform.integrations.some(
          (row) => row.key === 'ENABLE_DOM_SYNC' && row.url === 'true',
        )
      )
        continue;
      try {
        await this.sync(await this.contexts.resolve(platform.tag));
      } catch (error) {
        this.logger.warn(
          `Sync ${platform.tag}: ${error instanceof Error ? error.message : 'falhou'}`,
        );
      }
    }
  }

  sync(context: PlatformContext): Promise<unknown> {
    const active = this.running.get(context.id);
    if (active) return active;
    const task = this.execute(context).finally(() =>
      this.running.delete(context.id),
    );
    this.running.set(context.id, task);
    return task;
  }

  private async execute(context: PlatformContext) {
    if (context.acquirer !== 'DOM')
      unsupportedCapability('sync.' + context.acquirer);
    const corporate = corporateSync[context.tag as keyof typeof corporateSync];
    if (corporate)
      return this.modules
        .get<{ handleSync(): Promise<unknown> }>(corporate, { strict: false })
        .handleSync();
    const token = process.env.DOM_TOKEN;
    if (!token) unsupportedCapability('sync.configuration');
    const pending = await this.prisma.transaction.findMany({
      where: {
        status: 'PENDING',
        acquirer: 'DOM',
        ...whereTransactionPlatform(context.tag),
        domPaymentId: { not: null },
      },
      take: 100,
    });
    if (!pending.length) return { updated: 0 };
    const response = await this.gateway.listDomTransactions(token, {
      page: 1,
      limit: 100,
      begin_date: new Date(Date.now() - 3 * 86400000)
        .toISOString()
        .slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
    });
    let updated = 0;
    for (const transaction of pending) {
      const remote = response.transactions?.find(
        (row) =>
          String(row.id) === transaction.domPaymentId ||
          row.order_id === transaction.domPaymentId,
      );
      if (!remote) continue;
      const status = syncStatus(remote.status);
      if (
        !status ||
        status === 'PENDING' ||
        status === 'REFUNDED' ||
        status === 'CHARGEBACK'
      )
        continue;
      const changed = await this.prisma.$transaction(async (tx) => {
        const currentPlatform = await tx.platform.findUnique({
          where: { id: context.id },
          include: { owner: true },
        });
        if (
          !currentPlatform?.isActive ||
          !currentPlatform.owner.isActive ||
          currentPlatform.owner.isPurged ||
          currentPlatform.ownerUserId !== context.ownerUserId
        )
          return false;
        const result = await tx.transaction.updateMany({
          where: { id: transaction.id, status: 'PENDING' },
          data: { status, previousStatus: 'PENDING' },
        });
        if (!result.count) return false;
        if (status === 'COMPLETED') {
          if (transaction.netAmount === null)
            throw new Error('Transação sem líquido definido');
          await applyWalletEntry(tx, {
            userId: transaction.userId,
            action: 'PLATFORM_SYNC_COMPLETED',
            source: 'PLATFORM_SYNC',
            balanceDelta: transaction.netAmount,
            transactionId: transaction.id,
          });
        }
        return true;
      });
      if (changed) {
        updated++;
        this.events.emit(context.tag, 'transaction', {
          id: transaction.id,
          status,
        });
      }
    }
    return { updated };
  }
}
