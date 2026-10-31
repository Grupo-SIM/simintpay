import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { persistLinkCharge, settleFinalNet } from './link-settlement';
const d = (value: number) => new Prisma.Decimal(value);
function fixture() {
  let row: any = {
    id: 'sale',
    userId: 'original',
    paymentLinkId: 'link',
    settlementBasis: 'FINAL_NET',
    status: 'PENDING',
    netAmount: d(87),
    domPaymentId: 'gateway',
  };
  let wallet: any = {
    id: 'wallet',
    userId: 'original',
    balance: d(0),
    lockedBalance: d(0),
    version: 0,
  };
  let logs: any[] = [],
    history: any[] = [];
  let fail = false;
  const p: any = {
    user: { findUnique: async () => null },
    affiliateCommission: { findUnique: async () => null },
    transaction: {
      findUnique: async () => ({ ...row }),
      upsert: async () => ({ ...row }),
      updateMany: async ({ where, data }: any) => {
        if (where.status && row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    wallet: {
      findUnique: async () => ({ ...wallet }),
      updateMany: async ({ where, data }: any) => {
        if (where.version !== wallet.version) return { count: 0 };
        Object.assign(wallet, data, { version: wallet.version + 1 });
        return { count: 1 };
      },
    },
    balanceLog: {
      findFirst: async () =>
        logs.find((l) => l.action === 'LINK_SETTLEMENT_COMPLETED'),
      create: async ({ data }: any) => {
        if (fail) throw new Error('audit failed');
        logs.push(data);
      },
    },
    transactionStatusHistory: {
      create: async ({ data }: any) => history.push(data),
    },
  };
  const transaction = async (fn: (p: any) => Promise<any>) => {
    const before = {
      row: { ...row },
      wallet: { ...wallet },
      logs: [...logs],
      history: [...history],
    };
    try {
      return await fn(p);
    } catch (e) {
      row = before.row;
      wallet = before.wallet;
      logs = before.logs;
      history = before.history;
      throw e;
    }
  };
  return {
    p,
    transaction,
    row: () => row,
    wallet: () => wallet,
    logs: () => logs,
    history: () => history,
    fail: () => {
      fail = true;
    },
  };
}
test('response/webhook/polling race and replay produce exactly one credit and history record', async () => {
  const f = fixture(),
    stale = { ...f.row() };
  await Promise.all(
    ['RESPONSE', 'WEBHOOK', 'POLLING'].map((source) =>
      settleFinalNet(f.p, stale, 'COMPLETED', source),
    ),
  );
  expect(f.wallet().balance.toNumber()).toBe(87);
  expect(f.logs()).toHaveLength(1);
  expect(f.history()).toHaveLength(1);
  expect(await settleFinalNet(f.p, f.row(), 'COMPLETED', 'REPLAY')).toBe(false);
  expect(await settleFinalNet(f.p, f.row(), 'PENDING', 'REGRESSION')).toBe(
    false,
  );
});
test('audit failure rolls back status and wallet; no approval without credit', async () => {
  const f = fixture();
  f.fail();
  await expect(
    f.transaction((p) => settleFinalNet(p, f.row(), 'COMPLETED', 'RESPONSE')),
  ).rejects.toThrow('audit failed');
  expect(f.row().status).toBe('PENDING');
  expect(f.wallet().balance.toNumber()).toBe(0);
  expect(f.logs()).toHaveLength(0);
});
test('refund uses amount actually credited, preserves original wallet and terminal state', async () => {
  const f = fixture();
  await settleFinalNet(f.p, f.row(), 'COMPLETED', 'WEBHOOK');
  f.row().netAmount = d(50);
  await settleFinalNet(f.p, f.row(), 'REFUNDED', 'REFUND');
  expect(f.wallet().balance.toNumber()).toBe(0);
  expect(f.logs()[1].userId).toBe('original');
  expect(await settleFinalNet(f.p, f.row(), 'COMPLETED', 'LATE')).toBe(false);
});
test('mediation reserve restores or refunds once', async () => {
  const f = fixture();
  await settleFinalNet(f.p, f.row(), 'COMPLETED', 'WEBHOOK');
  await settleFinalNet(f.p, f.row(), 'IN_MEDIATION', 'MEDIATION');
  expect(f.wallet().balance.toNumber()).toBe(0);
  expect(f.wallet().lockedBalance.toNumber()).toBe(87);
  await settleFinalNet(f.p, f.row(), 'REFUNDED', 'REFUND');
  expect(f.wallet().balance.toNumber()).toBe(0);
  expect(f.wallet().lockedBalance.toNumber()).toBe(0);
});
test('late response cannot replace a settled snapshot or original ownership', async () => {
  const f = fixture();
  await settleFinalNet(f.p, f.row(), 'COMPLETED', 'WEBHOOK');
  await persistLinkCharge(
    f.p,
    {
      userId: 'original',
      paymentLinkId: 'link',
      domPaymentId: 'gateway',
      amount: 100,
      netAmount: 99,
    },
    'PENDING',
  );
  expect(f.row().netAmount.toNumber()).toBe(87);
  expect(f.row().status).toBe('COMPLETED');
  await expect(
    persistLinkCharge(
      f.p,
      {
        userId: 'new-owner',
        paymentLinkId: 'link',
        domPaymentId: 'gateway',
        amount: 100,
      },
      'COMPLETED',
    ),
  ).rejects.toThrow();
  expect(f.logs()).toHaveLength(1);
});

test('historical reversal prefers committed credit and preserves fallback for unlogged entries', async () => {
  const { creditedSettlementAmount } = await import('./link-settlement');
  const p: any = {
    balanceLog: {
      findFirst: async () => ({ balanceDelta: d(68), lockedDelta: d(0) }),
    },
  };
  expect((await creditedSettlementAmount(p, 'legacy', d(99))).toNumber()).toBe(
    68,
  );
  p.balanceLog.findFirst = async () => null;
  expect((await creditedSettlementAmount(p, 'legacy', d(99))).toNumber()).toBe(
    99,
  );
});
