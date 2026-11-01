import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformSyncPersistenceService } from './platform-sync-persistence.service';
import { PlatformEventsService } from './platform-events.service';
import { PlatformCorporateController } from './platform-corporate.controller';
import { AtlasSyncService } from '../atlas/services/atlas-sync.service';
import { RevalidaSyncService } from '../revalida/services/revalida-sync.service';
import {
  initializePlatformIntegrationsCache,
  invalidatePlatformIntegrationsCache,
} from '../platform-integrations/platform-integrations.store';
beforeEach(async () =>
  initializePlatformIntegrationsCache({
    platformIntegration: {
      findMany: async () =>
        ['ATLAS', 'REVALIDA'].map((tag) => ({
          platform: { tag },
          key: 'DOM_TOKEN',
          url: 'mock-token',
        })),
    },
  } as any),
);
afterEach(() => invalidatePlatformIntegrationsCache());
function fixture(tag: string, description = tag.toLowerCase()) {
  const context = {
    id: 'p',
    tag,
    ownerUserId: 'owner',
    acquirer: 'DOM' as const,
  };
  const platform = {
    ...context,
    isActive: true,
    owner: { isActive: true },
    updatedAt: new Date(0),
  };
  const wallet = {
    id: 'wallet',
    userId: 'owner',
    balance: new Prisma.Decimal(0),
    lockedBalance: new Prisma.Decimal(0),
    version: 0,
  };
  const rows: any[] = [];
  const p: any = {
    platform: {
      findUnique: async () => platform,
      findFirst: async () => platform,
      findMany: async () => [platform],
      update: async () => platform,
    },
    wallet: {
      findUnique: async () => wallet,
      findUniqueOrThrow: async () => wallet,
      upsert: async () => wallet,
      update: mock(async ({ data }: any) => {
        wallet.balance = wallet.balance.plus(data.balance.increment);
        wallet.version++;
        return wallet;
      }),
      updateMany: mock(async ({ data }: any) => {
        wallet.balance = data.balance;
        wallet.lockedBalance = data.lockedBalance;
        wallet.version++;
        return { count: 1 };
      }),
    },
    transaction: {
      findFirst: async (q: any) =>
        rows.find((row) =>
          q.where.OR.some(
            (cond: any) =>
              cond.domPaymentId === row.domPaymentId ||
              (cond.domTransactionId &&
                cond.domTransactionId === row.domTransactionId),
          ),
        ) ?? null,
      create: mock(async ({ data }: any) => {
        const row = { id: 't', ...data };
        rows.push(row);
        return row;
      }),
      aggregate: async () => ({
        _sum: {
          netAmount: rows
            .filter(
              (row) => row.userId === 'owner' && row.status === 'COMPLETED',
            )
            .reduce(
              (sum, row) => sum.plus(row.netAmount),
              new Prisma.Decimal(0),
            ),
        },
      }),
      count: async () => rows.filter((row) => row.userId === 'owner').length,
    },
    withdrawRequest: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    user: {
      findUnique: async () => ({ id: 'owner', name: 'Owner', cpf: '123' }),
    },
    externalPlatformUser: { upsert: async () => ({ id: 'external' }) },
    externalPlatformWallet: { upsert: mock(async () => ({})) },
    // Emulates the BalanceLog insert trigger that moves the wallet.
    balanceLog: {
      create: mock(async ({ data }: any) => {
        const delta = new Prisma.Decimal(data.balanceDelta ?? 0);
        if (!delta.isZero()) {
          wallet.balance = wallet.balance.plus(delta);
          wallet.version++;
        }
        return {};
      }),
    },
    $transaction: async (f: any) => f(p),
    $executeRaw: async () => 1,
  };
  let delivered = false;
  const gateway: any = {
    listDomTransactions: mock(async (_token: string, q: any) => {
      if (q.limit === 1 || delivered) return { transactions: [] };
      delivered = true;
      return {
        transactions: [
          {
            id: 'provider',
            order_id: 'payment',
            status: 'paid',
            amount: 100,
            liquid_amount: 91,
            product_first: description,
            created_at: '2024-02-01T12:00:00Z',
          },
        ],
      };
    }),
  };
  const events = new PlatformEventsService();
  const core = new PlatformSyncPersistenceService(p, events, gateway);
  return { context, platform, wallet, rows, p, gateway, core, events };
}
for (const [tag, Service] of [
  ['ATLAS', AtlasSyncService],
  ['REVALIDA', RevalidaSyncService],
] as const)
  test(`${tag} full-sync alias and canonical share history, maintenance and currency conversion`, async () => {
    const a = fixture(tag),
      b = fixture(tag);
    const legacy = await new Service(
      a.core,
      a.p,
      {} as any,
      a.gateway,
    ).syncFull();
    const canonical = await new PlatformCorporateController(
      { get: () => b.core } as any,
      b.p,
    ).history({ platformContext: b.context });
    const { balance, totalReceived, totalWithdrawn, ...data } = legacy;
    expect(canonical).toEqual({
      ...data,
      unit: 'cents',
      balanceCents: balance * 100,
      totalReceivedCents: totalReceived * 100,
      totalWithdrawnCents: totalWithdrawn * 100,
    });
    expect(legacy).toMatchObject({
      success: true,
      totalSynced: 1,
      totalUpdated: 0,
      totalErrors: 0,
      totalInDatabase: 1,
      balance: 91,
    });
    expect(a.wallet.balance.toNumber()).toBe(b.wallet.balance.toNumber());
    expect(a.rows[0].createdAt).toEqual(new Date('2024-02-01T12:00:00Z'));
    expect(a.rows[0].description).toContain(`[TENANT:${tag}]`);
    // One row for the synced credit and one for the maintenance recalculation.
    expect(a.p.balanceLog.create).toHaveBeenCalledTimes(2);
  });
test('full-sync blocks shared wallet before gateway or ledger mutation', async () => {
  const { core, p, gateway } = fixture('ATLAS');
  p.platform.findMany = async () => [{ tag: 'ATLAS' }, { tag: 'BOSQUE' }];
  await expect(core.history('ATLAS')).rejects.toMatchObject({
    response: { code: 'SHARED_WALLET_MAINTENANCE_FORBIDDEN' },
  });
  expect(gateway.listDomTransactions).not.toHaveBeenCalled();
  expect(p.transaction.create).not.toHaveBeenCalled();
});
test('simultaneous historical requests coalesce and polling waits for the full run', async () => {
  const { core, gateway } = fixture('ATLAS');
  const first = core.history('ATLAS'),
    second = core.history('ATLAS');
  expect(first).toBe(second);
  const poll = core.poll('ATLAS');
  await Promise.all([first, second, poll]);
  expect(
    gateway.listDomTransactions.mock.calls.filter(
      (args: any[]) => args[1].limit === 1,
    ),
  ).toHaveLength(1);
});
test('full-sync cannot adopt an untagged transaction or move historical ownership', async () => {
  const { core, rows, p } = fixture('ATLAS');
  rows.push({
    id: 'old',
    userId: 'previous-owner',
    description: 'atlas legacy',
    domPaymentId: 'payment',
    status: 'COMPLETED',
    amount: new Prisma.Decimal(100),
    netAmount: new Prisma.Decimal(91),
    acquirer: 'DOM',
  });
  await core.history('ATLAS');
  expect(rows[0].userId).toBe('previous-owner');
  expect(rows[0].description).toBe('atlas legacy');
  expect(p.wallet.update).not.toHaveBeenCalled();
  expect(p.transaction.create).not.toHaveBeenCalled();
});

for (const description of [
  'DOMAIN example.com [TENANT:ATLAS]',
  'HOSTING VPS-10-1784846 [TENANT:ATLAS]',
]) {
  test(`full-sync identifies platform from marker without brand in product name: ${description}`, async () => {
    const f = fixture('ATLAS', description);
    const result = await f.core.history('ATLAS');
    expect(result).toMatchObject({ success: true, totalSynced: 1 });
    expect(f.rows[0].description).toBe(description);
  });
}
