import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { AtlasSyncService } from '../../atlas/services/atlas-sync.service';
import { RevalidaSyncService } from '../../revalida/services/revalida-sync.service';
import { AtlasDashboardController } from '../../atlas/controllers/atlas-dashboard.controller';
import { RevalidaDashboardController } from '../../revalida/controllers/revalida-dashboard.controller';
import { PlatformMaintenanceService } from '../../unified-platform/finance/platform-maintenance.service';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';

beforeEach(async () => {
  await initializePlatformTaxasCache({
    platformTaxaOverride: {
      findMany: async () =>
        ['ATLAS', 'REVALIDA'].map((tag) => ({
          tag,
          key: 'LIQUIDEZ',
          value: 0.91,
        })),
    },
  } as any);
});
afterEach(async () => {
  await initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as any);
});

function fixture(tag: string, before = 100, locked = 10) {
  const context = {
    id: 'product',
    tag,
    ownerUserId: 'owner',
    acquirer: 'DOM' as const,
  };
  const platform = {
    ...context,
    isActive: true,
    updatedAt: new Date(),
    owner: { isActive: true, isPurged: false },
  };
  const wallet = {
    id: 'wallet',
    version: 4,
    balance: new Prisma.Decimal(before),
    lockedBalance: new Prisma.Decimal(locked),
  };
  const tx: any = {
    platform: {
      findMany: mock(async () => [platform]),
      update: mock(async () => platform),
    },
    wallet: {
      findUnique: mock(async () => wallet),
      updateMany: mock(async () => ({ count: 1 })),
    },
    balanceLog: { create: mock(async () => ({})) },
    $executeRaw: mock(async () => 1),
  };
  const p: any = {
    platform: {
      findFirst: async () => platform,
      findMany: async () => [platform],
      findUnique: async () => null,
    },
    wallet: { findUnique: async () => wallet },
    $transaction: async (fn: any, options: any) => {
      expect(options.isolationLevel).toBe('Serializable');
      return fn(tx);
    },
  };
  const sync =
    tag === 'ATLAS'
      ? new AtlasSyncService({} as any, p, {} as any, {} as any)
      : new RevalidaSyncService({} as any, p, {} as any, {} as any);
  const controller =
    tag === 'ATLAS'
      ? new AtlasDashboardController({} as any, sync as AtlasSyncService, p)
      : new RevalidaDashboardController(
          {} as any,
          sync as RevalidaSyncService,
          p,
        );
  return { context, tx, p, wallet, controller };
}

for (const tag of ['ATLAS', 'REVALIDA']) {
  test(`${tag} liquid balance alias and canonical gross cents produce same wallet and ledger amounts`, async () => {
    const legacy = fixture(tag, 20, 10),
      canonical = fixture(tag, 20, 10);
    const response = await legacy.controller.setBalance({ balance: 91 });
    expect(response).toMatchObject({
      success: true,
      netBalance: 91,
      grossBalance: 100,
      userId: 'owner',
    });
    const result = await new PlatformMaintenanceService(canonical.p).run(
      canonical.context,
      'set-balance',
      {
        balanceCents: 10000,
        reason: 'Saldo definido manualmente com liquidez',
      },
    );
    expect(result.after).toEqual({
      balanceCents: 10000,
      lockedBalanceCents: 1000,
    });
    expect(legacy.tx.wallet.updateMany.mock.calls).toEqual(
      canonical.tx.wallet.updateMany.mock.calls,
    );
    const legacyAudit = legacy.tx.balanceLog.create.mock.calls[0][0].data;
    const canonicalAudit = canonical.tx.balanceLog.create.mock.calls[0][0].data;
    for (const field of [
      'amount',
      'balanceBefore',
      'balanceAfter',
      'lockedBefore',
      'lockedAfter',
    ])
      expect(legacyAudit[field].eq(canonicalAudit[field])).toBe(true);
    expect(legacyAudit.action).toBe('WALLET_RECALCULATE');
    expect(legacyAudit.source).toBe('ADMIN_SYNC');
  });

  test(`${tag} zero alias and canonical operation persist identical wallet corrections`, async () => {
    const legacy = fixture(tag),
      canonical = fixture(tag);
    const response = await legacy.controller.zeroWallet();
    const result = await new PlatformMaintenanceService(canonical.p).run(
      canonical.context,
      'zero-wallet',
      { reason: 'Reset autorizado' },
    );
    expect(response).toMatchObject({
      success: true,
      userId: 'owner',
      balanceAntes: 100,
      lockedAntes: 10,
      alreadyZero: false,
    });
    expect(result).toMatchObject({
      unit: 'cents',
      before: { balanceCents: 10000, lockedBalanceCents: 1000 },
      after: { balanceCents: 0, lockedBalanceCents: 0 },
    });
    expect(legacy.tx.wallet.updateMany.mock.calls).toEqual(
      canonical.tx.wallet.updateMany.mock.calls,
    );
    const audit = legacy.tx.balanceLog.create.mock.calls[0][0].data;
    expect(audit.amount.eq(-100)).toBe(true);
    expect(audit.action).toBe(`${tag}_WALLET_ZERO`);
    expect(audit.metadata.platform).toBe(tag.toLowerCase());
  });

  test(`${tag} zero alias reports transactional balance rather than stale preliminary read`, async () => {
    const { controller, tx } = fixture(tag, 0, 0);
    tx.wallet.findUnique.mockResolvedValue({
      id: 'wallet',
      version: 5,
      balance: new Prisma.Decimal(25),
      lockedBalance: new Prisma.Decimal(3),
    });
    expect(await controller.zeroWallet()).toMatchObject({
      balanceAntes: 25,
      lockedAntes: 3,
      alreadyZero: false,
    });
    expect(tx.balanceLog.create).toHaveBeenCalledTimes(1);
  });

  test(`${tag} already-zero alias still revalidates shared-wallet restriction in transaction`, async () => {
    const { controller, tx } = fixture(tag, 0, 0);
    tx.platform.findMany.mockImplementation(async () => [
      { tag },
      { tag: 'OTHER' },
    ]);
    await expect(controller.zeroWallet()).rejects.toThrow(
      'Carteira sem vínculo exclusivo',
    );
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.balanceLog.create).not.toHaveBeenCalled();
  });

  test(`${tag} already-zero alias preserves response without extra financial writes`, async () => {
    const { controller, tx } = fixture(tag, 0, 0);
    expect(await controller.zeroWallet()).toMatchObject({
      success: true,
      balanceAntes: 0,
      lockedAntes: 0,
      alreadyZero: true,
    });
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.balanceLog.create).not.toHaveBeenCalled();
  });
}
