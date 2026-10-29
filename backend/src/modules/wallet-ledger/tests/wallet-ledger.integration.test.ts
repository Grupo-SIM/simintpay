import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { applyWalletEntry, setWalletBalance } from '../wallet-ledger';
import {
  findWalletLedgerDivergences,
  getWalletBalance,
  walletAmounts,
} from '../wallet-balance';

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
afterAll(async () => {
  await db?.$disconnect();
});
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 30000);

const newUser = () =>
  db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Ledger',
      password: 'x',
      role: 'USER',
    },
  });

run(
  'signed credit, lock, unlock, debit and reversal reconcile both sums',
  async () => {
    const user = await newUser();
    await db!.$transaction(async (tx) => {
      for (const [action, balanceDelta, lockedDelta] of [
        ['CREDIT', '100.01', '0'],
        ['LOCK', '0', '30.01'],
        ['UNLOCK', '0', '-10'],
        ['DEBIT', '-20.01', '-20.01'],
        ['REVERSAL', '20.01', '0'],
      ])
        await applyWalletEntry(tx, {
          userId: user.id,
          action,
          source: 'TEST',
          balanceDelta,
          lockedDelta,
        });
    });
    const rows = await db!.balanceLog.findMany({ where: { userId: user.id } });
    expect(
      rows
        .map((row) => [
          row.action,
          row.balanceDelta.toFixed(2),
          row.lockedDelta.toFixed(2),
        ])
        .sort(),
    ).toEqual([
      ['CREDIT', '100.01', '0.00'],
      ['DEBIT', '-20.01', '-20.01'],
      ['LOCK', '0.00', '30.01'],
      ['REVERSAL', '20.01', '0.00'],
      ['UNLOCK', '0.00', '-10.00'],
    ]);
    expect(await getWalletBalance(db!, user.id)).toMatchObject({
      balance: 100.01,
      lockedBalance: 0,
      ledgerBalance: 100.01,
      ledgerLockedBalance: 0,
      ledgerDrift: 0,
      ledgerLockedDrift: 0,
    });
  },
);

run(
  'parallel entries use atomic increments and rollbacks leave no partial ledger/projection',
  async () => {
    const user = await newUser();
    await db!.$transaction((tx) =>
      applyWalletEntry(tx, { userId: user.id, action: 'OPEN', source: 'TEST' }),
    );
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        db!.$transaction((tx) =>
          applyWalletEntry(tx, {
            userId: user.id,
            action: `CREDIT_${index}`,
            source: 'TEST',
            balanceDelta: '0.01',
            lockedDelta: '0.01',
          }),
        ),
      ),
    );
    await expect(
      db!.$transaction(async (tx) => {
        await applyWalletEntry(tx, {
          userId: user.id,
          action: 'ROLLBACK',
          source: 'TEST',
          balanceDelta: 99,
          lockedDelta: 99,
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(
      await db!.balanceLog.count({
        where: { userId: user.id, action: 'ROLLBACK' },
      }),
    ).toBe(0);
    expect(await getWalletBalance(db!, user.id)).toMatchObject({
      balance: 0.2,
      lockedBalance: 0.2,
      ledgerBalance: 0.2,
      ledgerLockedBalance: 0.2,
      ledgerDrift: 0,
      ledgerLockedDrift: 0,
    });
    await expect(
      db!.$transaction((tx) =>
        applyWalletEntry(tx, {
          userId: user.id,
          action: 'TOO_LARGE',
          source: 'TEST',
          balanceDelta: '100000000000000',
        }),
      ),
    ).rejects.toThrow();
    expect((await getWalletBalance(db!, user.id)).balance).toBe(0.2);
  },
);

run('absolute set logs only differences', async () => {
  const user = await newUser();
  await db!.$transaction((tx) =>
    applyWalletEntry(tx, {
      userId: user.id,
      action: 'OPEN',
      source: 'TEST',
      balanceDelta: 100,
    }),
  );
  await db!.$transaction((tx) =>
    setWalletBalance(tx, {
      userId: user.id,
      balance: '35.55',
      action: 'SET',
      source: 'TEST',
    }),
  );
  const row = await db!.balanceLog.findFirstOrThrow({
    where: { userId: user.id, action: 'SET' },
  });
  expect(row.balanceDelta.toFixed(2)).toBe('-64.45');
  expect((await getWalletBalance(db!, user.id)).ledgerDrift).toBe(0);
});

run(
  'empty ledger opens at zero and unsupported opening or locked balances remain drift',
  async () => {
    const user = await newUser();
    expect(await getWalletBalance(db!, user.id)).toMatchObject({
      ledgerBalance: 0,
      ledgerLockedBalance: 0,
      ledgerDrift: 0,
      ledgerLockedDrift: 0,
    });
    await db!.wallet.create({
      data: { userId: user.id, balance: '5.01', lockedBalance: '1.01' },
    });
    const row = (await findWalletLedgerDivergences(db!)).find(
      (item) => item.userId === user.id,
    )!;
    expect([row.drift.toFixed(2), row.lockedDrift.toFixed(2)]).toEqual([
      '5.01',
      '1.01',
    ]);
    await db!.balanceLog.create({
      data: {
        userId: user.id,
        action: 'BOOKKEEPING',
        source: 'MASTER_ADMIN_CONTROL',
        bookkeepingAmount: 9999,
        balanceDelta: 0,
        lockedDelta: 0,
      },
    });
    expect(await getWalletBalance(db!, user.id)).toMatchObject({
      ledgerBalance: 0,
      ledgerLockedBalance: 0,
      ledgerDrift: 5.01,
      ledgerLockedDrift: 1.01,
    });
  },
);

run('locked-only drift is detected even when balance agrees', async () => {
  const user = await newUser();
  await db!.$transaction((tx) =>
    applyWalletEntry(tx, {
      userId: user.id,
      action: 'OPEN',
      source: 'TEST',
      balanceDelta: 10,
      lockedDelta: 2,
    }),
  );
  await db!.wallet.update({
    where: { userId: user.id },
    data: { lockedBalance: 3 },
  });
  const found = (await findWalletLedgerDivergences(db!)).find(
    (row) => row.userId === user.id,
  )!;
  expect(found.drift.toFixed(2)).toBe('0.00');
  expect(found.lockedDrift.toFixed(2)).toBe('1.00');
});

run(
  'historical migration uses exact snapshot differences and preserves bookkeeping and metadata',
  async () => {
    const pg = new Client({ connectionString: url });
    await pg.connect();
    const schema = `ledger_history_${crypto.randomUUID().replaceAll('-', '')}`;
    try {
      await pg.query(`CREATE SCHEMA "${schema}"`);
      await pg.query(`SET search_path TO "${schema}"`);
      await pg.query(
        `CREATE TABLE "BalanceLog" (id TEXT PRIMARY KEY, "userId" TEXT, action TEXT, "transactionId" TEXT, source TEXT, description TEXT, metadata JSONB, "createdAt" TIMESTAMP, amount DECIMAL(12,2), "balanceBefore" DECIMAL(12,2) NOT NULL, "balanceAfter" DECIMAL(12,2) NOT NULL, "lockedBefore" DECIMAL(12,2) NOT NULL, "lockedAfter" DECIMAL(12,2) NOT NULL)`,
      );
      await pg.query(`INSERT INTO "BalanceLog" VALUES
      ('credit','u','CREDIT','tx','WEBHOOK','keep', '{"original":true}', '2026-01-01', 999, 100.01, 120.03, 2.01, 2.01),
      ('lock','u','LOCK',NULL,'WITHDRAW',NULL, NULL, '2026-01-02', -5.05, 120.03, 120.03, 2.01, 7.06),
      ('fee','admin','ADMIN_WITHDRAW_PROFIT_INC',NULL,'MASTER_ADMIN_CONTROL',NULL, '{"rate":"0.50"}', '2026-01-03', 4.99, 0, 0, 0, 0),
      ('purge','u','PURGE_ABSORB',NULL,'MASTER_ADMIN_CONTROL',NULL, '{}', '2026-01-04', 120.03, 120.03, 0, 7.06, 0)`);
      const sql = readFileSync(
        new URL(
          '../../../../prisma/migrations/20261029200000_normalize_balance_log_deltas/migration.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await pg.query(sql);
      const result = await pg.query(
        'SELECT * FROM "BalanceLog" ORDER BY "createdAt"',
      );
      expect(
        result.rows.map((row) => [
          row.id,
          row.balanceDelta,
          row.lockedDelta,
          row.bookkeepingAmount,
        ]),
      ).toEqual([
        ['credit', '20.02', '0.00', null],
        ['lock', '0.00', '5.05', null],
        ['fee', '0.00', '0.00', '4.99'],
        ['purge', '-120.03', '-7.06', '120.03'],
      ]);
      expect(result.rows[0]).toMatchObject({
        userId: 'u',
        action: 'CREDIT',
        transactionId: 'tx',
        source: 'WEBHOOK',
        description: 'keep',
        metadata: { original: true },
      });
      expect(result.rows[2].metadata).toEqual({ rate: '0.50' });
      expect(Object.keys(result.rows[0])).not.toContain('amount');
      for (const key of [
        'balanceBefore',
        'balanceAfter',
        'lockedBefore',
        'lockedAfter',
      ])
        expect(Object.keys(result.rows[0])).not.toContain(key);
      const sums = await pg.query(
        'SELECT SUM("balanceDelta") AS balance, SUM("lockedDelta") AS locked FROM "BalanceLog"',
      );
      expect(sums.rows[0]).toEqual({ balance: '-100.01', locked: '-2.01' });
    } finally {
      await pg.query('ROLLBACK');
      await pg.query('SET search_path TO public');
      await pg.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pg.end();
    }
  },
);

test('walletAmounts applies max(0, balance - locked)', () => {
  expect(walletAmounts({ balance: '123.45', lockedBalance: '23.45' })).toEqual({
    balance: 123.45,
    lockedBalance: 23.45,
    available: 100,
  });
  expect(walletAmounts({ balance: 5, lockedBalance: 9 }).available).toBe(0);
});
