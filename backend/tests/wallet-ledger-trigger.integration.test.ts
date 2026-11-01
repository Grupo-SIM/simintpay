import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import {
  applyWalletEntry,
  lockWalletLedger,
  setWalletBalance,
} from '../src/modules/wallet-ledger/wallet-ledger';
import { walletAmounts } from '../src/modules/wallet-ledger/wallet-balance';

// Local disposable Postgres only (COPRODUCTION_TEST_DATABASE_URL, db push applied).
const url = process.env.COPRODUCTION_TEST_DATABASE_URL;
if (
  url &&
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)
) {
  throw new Error('Tests require a local isolated database');
}
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const migrationSql = readFileSync(
  resolve(
    import.meta.dir,
    '../prisma/migrations/20261031130000_balance_log_drives_wallet/migration.sql',
  ),
  'utf8',
);
const guardRe =
  /-- wallet-ledger-divergence-guard:begin[\s\S]*?-- wallet-ledger-divergence-guard:end/;
const guard = migrationSql.match(guardRe)![0];

const withPg = async <T>(body: (pg: Client) => Promise<T>) => {
  const pg = new Client({ connectionString: url });
  await pg.connect();
  try {
    return await body(pg);
  } finally {
    await pg.end();
  }
};

beforeAll(async () => {
  if (!url) return;
  // Triggers live only in migrations (db push does not create them). A shared test database may hold
  // drift rows, so the guard is skipped here and exercised by its own test below.
  await withPg((pg) => pg.query(migrationSql.replace(guardRe, '')));
});
afterAll(async () => {
  await db?.$disconnect();
});
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 30000);

const newUser = () =>
  db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Trigger',
      password: 'x',
      role: 'USER',
    },
  });
const insertLog = (
  userId: string,
  balanceDelta: string,
  lockedDelta = '0',
  action = 'TEST',
) =>
  db!.balanceLog.create({
    data: { userId, action, source: 'TEST', balanceDelta, lockedDelta },
  });
const wallet = (userId: string) =>
  db!.wallet.findUniqueOrThrow({ where: { userId } });

run(
  'a log insert creates the wallet and keeps it equal to the sums',
  async () => {
    const user = await newUser();
    await insertLog(user.id, '100.50', '10');
    let w = await wallet(user.id);
    expect([w.balance.toFixed(2), w.lockedBalance.toFixed(2)]).toEqual([
      '100.50',
      '10.00',
    ]);
    expect(w.version).toBe(1);
    await insertLog(user.id, '-20.25', '-10');
    w = await wallet(user.id);
    expect([
      w.balance.toFixed(2),
      w.lockedBalance.toFixed(2),
      w.version,
    ]).toEqual(['80.25', '0.00', 2]);
  },
);

run(
  'zero-delta bookkeeping rows do not bump version or touch updatedAt',
  async () => {
    const user = await newUser();
    await insertLog(user.id, '5');
    const before = await wallet(user.id);
    await db!.balanceLog.create({
      data: {
        userId: user.id,
        action: 'BOOKKEEPING',
        source: 'MASTER_ADMIN_CONTROL',
        bookkeepingAmount: 999,
        balanceDelta: 0,
        lockedDelta: 0,
      },
    });
    const after = await wallet(user.id);
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.balance.toFixed(2)).toBe('5.00');
  },
);

run('a RECONCILIATION adjustment realigns a drifted wallet', async () => {
  const user = await newUser();
  await insertLog(user.id, '50');
  // Simulate drift introduced by a legacy writer that skipped the log.
  await db!.wallet.update({
    where: { userId: user.id },
    data: { balance: '80', lockedBalance: '3' },
  });
  // reconcile-wallets.ts inserts the (log - wallet) difference as ADJUSTMENT/RECONCILIATION.
  await db!.balanceLog.create({
    data: {
      userId: user.id,
      action: 'ADJUSTMENT',
      source: 'RECONCILIATION',
      balanceDelta: '30',
      lockedDelta: '3',
    },
  });
  const w = await wallet(user.id);
  // The trigger recomputes from the log, so the wallet becomes the log sum (80 / 3).
  expect([w.balance.toFixed(2), w.lockedBalance.toFixed(2)]).toEqual([
    '80.00',
    '3.00',
  ]);
  const [{ b, l }] = await db!.$queryRaw<{ b: string; l: string }[]>`
    SELECT SUM("balanceDelta")::text b, SUM("lockedDelta")::text l FROM "BalanceLog" WHERE "userId" = ${user.id}`;
  expect([b, l]).toEqual(['80.00', '3.00']);
});

run(
  'legacy writer (wallet.update + balanceLog.create) ends equal to the sum',
  async () => {
    const user = await newUser();
    await insertLog(user.id, '100');
    const before = await wallet(user.id);
    await db!.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: user.id },
        data: {
          balance: { decrement: 40 },
          lockedBalance: { increment: 5 },
          version: { increment: 1 },
        },
      });
      await tx.balanceLog.create({
        data: {
          userId: user.id,
          action: 'LEGACY',
          source: 'TEST',
          balanceDelta: -40,
          lockedDelta: 5,
        },
      });
    });
    const w = await wallet(user.id);
    expect([w.balance.toFixed(2), w.lockedBalance.toFixed(2)]).toEqual([
      '60.00',
      '5.00',
    ]);
    // The legacy writer's own bump stays; the trigger found the sums equal and added none.
    expect(w.version).toBe(before.version + 1);
  },
);

run(
  'applyWalletEntry and setWalletBalance only insert log rows; the trigger moves the wallet',
  async () => {
    const user = await newUser();
    const created = await db!.$transaction((tx) =>
      applyWalletEntry(tx, {
        userId: user.id,
        action: 'CREDIT',
        source: 'TEST',
        balanceDelta: '12.34',
      }),
    );
    expect(created.balance.toFixed(2)).toBe('12.34');
    const set = await db!.$transaction((tx) =>
      setWalletBalance(tx, {
        userId: user.id,
        action: 'SYNC',
        source: 'TEST',
        balance: '20',
      }),
    );
    expect(set.balance.toFixed(2)).toBe('20.00');
    const rows = await db!.balanceLog.findMany({
      where: { userId: user.id, action: 'SYNC' },
    });
    expect(rows.map((r) => r.balanceDelta.toFixed(2))).toEqual(['7.66']);
  },
);

run('concurrent transactions for the same user both land', async () => {
  const user = await newUser();
  await insertLog(user.id, '1');
  const worker = (delta: string) =>
    db!.$transaction(async (tx) => {
      await tx.balanceLog.create({
        data: {
          userId: user.id,
          action: 'CONCURRENT',
          source: 'TEST',
          balanceDelta: delta,
          lockedDelta: 0,
        },
      });
      // Hold the transaction open so the second insert must wait on the lock.
      await new Promise((r) => setTimeout(r, 300));
    });
  await Promise.all([
    worker('10'),
    worker('100'),
    worker('1000'),
    worker('-5'),
  ]);
  const w = await wallet(user.id);
  expect(w.balance.toFixed(2)).toBe('1106.00');
});

run(
  'concurrent legacy writer and log-only writer do not deadlock or lose deltas',
  async () => {
    const user = await newUser();
    await insertLog(user.id, '100');
    const legacy = db!.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: user.id },
        data: { balance: { increment: 10 }, version: { increment: 1 } },
      });
      await new Promise((r) => setTimeout(r, 300));
      await tx.balanceLog.create({
        data: {
          userId: user.id,
          action: 'LEGACY',
          source: 'TEST',
          balanceDelta: 10,
          lockedDelta: 0,
        },
      });
    });
    await new Promise((r) => setTimeout(r, 50));
    const modern = db!.$transaction((tx) =>
      applyWalletEntry(tx, {
        userId: user.id,
        action: 'MODERN',
        source: 'TEST',
        balanceDelta: 1,
      }),
    );
    await Promise.all([legacy, modern]);
    expect((await wallet(user.id)).balance.toFixed(2)).toBe('111.00');
  },
);

run(
  'lockWalletLedger serializes a reader against concurrent log inserts',
  async () => {
    const user = await newUser();
    await insertLog(user.id, '100');
    const order: string[] = [];
    const reader = db!.$transaction(async (tx) => {
      await lockWalletLedger(tx, user.id);
      order.push('locked');
      await new Promise((r) => setTimeout(r, 300));
      const w = await tx.wallet.findUniqueOrThrow({
        where: { userId: user.id },
      });
      order.push(`read:${w.balance.toFixed(2)}`);
    });
    await new Promise((r) => setTimeout(r, 100));
    const writer = db!.$transaction(async (tx) => {
      await tx.balanceLog.create({
        data: {
          userId: user.id,
          action: 'W',
          source: 'TEST',
          balanceDelta: -100,
          lockedDelta: 0,
        },
      });
      order.push('written');
    });
    await Promise.all([reader, writer]);
    expect(order).toEqual(['locked', 'read:100.00', 'written']);
  },
);

run(
  'negative sums are stored as-is; the floor applies only when reading',
  async () => {
    const user = await newUser();
    await insertLog(user.id, '-30', '5');
    const w = await wallet(user.id);
    expect([w.balance.toFixed(2), w.lockedBalance.toFixed(2)]).toEqual([
      '-30.00',
      '5.00',
    ]);
    expect(walletAmounts(w)).toMatchObject({
      balance: -30,
      lockedBalance: 5,
      available: 0,
    });
  },
);

run(
  'the migration guard aborts while a wallet differs from the log',
  async () => {
    const user = await newUser();
    await insertLog(user.id, '10');
    await db!.wallet.update({
      where: { userId: user.id },
      data: { balance: '11' },
    });
    const count = Number(
      (
        await db!.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) n FROM "Wallet" w
        LEFT JOIN (SELECT "userId", SUM("balanceDelta") b, SUM("lockedDelta") l
                   FROM "BalanceLog" GROUP BY "userId") x ON x."userId" = w."userId"
        WHERE w.balance IS DISTINCT FROM COALESCE(x.b, 0)
           OR w."lockedBalance" IS DISTINCT FROM COALESCE(x.l, 0)`
      )[0].n,
    );
    expect(count).toBeGreaterThanOrEqual(1);
    await withPg(async (pg) => {
      await expect(pg.query(guard)).rejects.toThrow(
        new RegExp(`${count} wallet\\(s\\) differ from SUM\\(BalanceLog\\)`),
      );
    });
    // Reconcile and the guard passes for this wallet (other drift rows may still exist in a shared DB).
    await db!.wallet.update({
      where: { userId: user.id },
      data: { balance: '10' },
    });
    const w = await wallet(user.id);
    expect(w.balance.toFixed(2)).toBe('10.00');
  },
);
