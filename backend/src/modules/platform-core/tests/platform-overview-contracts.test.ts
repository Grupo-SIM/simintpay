import { beforeEach, afterEach, expect, test } from 'bun:test';
import { PlatformDashboardService } from '../../renovada/services/renovada-dashboard.service';
import { PlatformDashboardController } from '../../renovada/controllers/renovada-dashboard.controller';
import { PlatformReportProjectionsController } from '../platform-report-projections.controller';
import { initializePlatformRegistryCache } from '../../module.registry';
import { matches } from './platform-query-fixture';
beforeEach(async () =>
  initializePlatformRegistryCache({
    platform: {
      findMany: async () => [{ tag: 'ATLAS', ownerUserId: 'owner' }],
    },
  } as any),
);
afterEach(async () =>
  initializePlatformRegistryCache({
    platform: { findMany: async () => [] },
  } as any),
);
function fixture() {
  const context = {
    id: 'p',
    tag: 'ATLAS',
    ownerUserId: 'owner',
    acquirer: 'DOM' as const,
  };
  const platform = { ...context, isActive: true, owner: { isActive: true } };
  const rows = [
    {
      id: 'sale',
      userId: 'owner',
      status: 'COMPLETED',
      amount: 123.45,
      netAmount: 100,
      description: '[TENANT:ATLAS]',
      platformTag: 'ATLAS',
      createdAt: new Date(),
    },
  ];
  const withdrawals = [
    {
      id: 'w',
      userId: 'owner',
      platform: 'atlas',
      status: 'COMPLETED',
      amount: 10,
      grossAmount: 12,
      fee: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const p: any = {
    platform: { findUnique: async () => platform },
    wallet: { findUnique: async () => ({ balance: 100, lockedBalance: 5 }) },
    transaction: {
      findMany: async ({ where }: any) =>
        rows.filter((row) => matches(row, where)),
      aggregate: async ({ where }: any) => {
        const r = rows.filter((row) => matches(row, where));
        return {
          _count: { id: r.length },
          _sum: { netAmount: r.reduce((n, t) => n + t.netAmount, 0) },
        };
      },
    },
    withdrawRequest: {
      findMany: async ({ where }: any) =>
        withdrawals.filter((row) => matches(row, where)),
    },
    balanceLog: { aggregate: async () => ({ _sum: { amount: 1 } }) },
  };
  return {
    context,
    platform,
    rows,
    withdrawals,
    p,
    alias: new PlatformDashboardController(
      new PlatformDashboardService(p),
      p,
      {} as any,
    ),
    canonical: new PlatformReportProjectionsController(p, {} as any, {} as any),
  };
}
test('generic dashboard alias and canonical overview preserve financial projection and count units', async () => {
  const f = fixture();
  const old = await f.alias.getStats('ATLAS');
  const current = await f.canonical.overview({ platformContext: f.context });
  expect(current.data.profit.totalCents).toBe(
    Math.round(old.profit.total * 100),
  );
  expect(current.data.profit.today.totalCents).toBe(
    Math.round(old.profit.today.total * 100),
  );
  expect(current.data.withdrawals).toEqual(old.withdrawals);
  expect(current.data.estornos.quantidade).toBe(old.estornos.quantidade);
  expect(current.data.saqueFees.quantidade).toBe(1);
  expect(current.data.saqueFees.taxaTotalCents).toBe(300);
  expect(current.data.summary.availableBalanceCents).toBe(
    Math.round(old.summary.availableBalance * 100),
  );
});
test('generic withdrawal detail alias and canonical preserve recorded fees, count and cents', async () => {
  const f = fixture();
  const old = await f.alias.getSaques('ATLAS');
  const current = await f.canonical.withdrawalFees({
    platformContext: f.context,
  });
  expect(current.quantidade).toBe(old.quantidade);
  expect(current.totalFeeCents).toBe(200);
  expect(current.data[0]).toMatchObject({
    id: old.data[0].id,
    valorBrutoCents: 1200,
    valorLiquidoCents: 1000,
    taxaCobradaCents: 200,
  });
});
test('canonical overview excludes ambiguous and untagged history and other product withdrawals', async () => {
  const f = fixture();
  f.rows.push(
    {
      ...f.rows[0],
      id: 'mixed',
      netAmount: 500,
      description: '[TENANT:ATLAS]',
      platformTag: 'OTHER',
    },
    {
      ...f.rows[0],
      id: 'unidentified',
      netAmount: 600,
      description: 'atlas legacy',
      platformTag: null,
    },
  );
  f.withdrawals.push({
    ...f.withdrawals[0],
    id: 'other',
    platform: 'other',
    fee: 100,
  });
  const result = await f.canonical.overview({ platformContext: f.context });
  expect(result.data.profit.totalCents).toBe(10000);
  expect(result.data.saqueFees.lucroSimpayCents).toBe(200);
  expect(
    (await f.canonical.withdrawalFees({ platformContext: f.context }))
      .quantidade,
  ).toBe(1);
  f.platform.ownerUserId = 'transferred';
  await expect(
    f.canonical.overview({ platformContext: f.context }),
  ).rejects.toThrow('Contexto');
});

test('canonical overview uses revalidated current owner even while legacy registry cache is stale', async () => {
  const f = fixture();
  await initializePlatformRegistryCache({
    platform: {
      findMany: async () => [{ tag: 'ATLAS', ownerUserId: 'old-owner' }],
    },
  } as any);
  let selectedOwner: string | undefined;
  f.p.wallet.findUnique = async ({ where }: any) => {
    selectedOwner = where.userId;
    return { balance: 100, lockedBalance: 5 };
  };
  const result = await f.canonical.overview({ platformContext: f.context });
  expect(selectedOwner).toBe('owner');
  expect(result.data.profit.totalCents).toBe(10000);
});
