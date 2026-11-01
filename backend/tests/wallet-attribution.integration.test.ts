import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import {
  applyWalletEntry,
  setWalletBalance,
} from '../src/modules/wallet-ledger/wallet-ledger';
import { readWalletAttribution } from '../src/modules/wallet-ledger/wallet-attribution';

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
beforeAll(async () => {
  if (!url) return;
  const pg = new Client({ connectionString: url });
  await pg.connect();
  try {
    const sql = readFileSync(
      resolve(
        import.meta.dir,
        '../prisma/migrations/20261031130000_balance_log_drives_wallet/migration.sql',
      ),
      'utf8',
    );
    await pg.query(sql);
  } finally {
    await pg.end();
  }
});
afterAll(async () => {
  await db?.$disconnect();
});
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 30000);
const user = () =>
  db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Attribution',
      password: 'x',
      role: 'USER',
    },
  });

run(
  'signed attributed and unknown buckets preserve legacy totals without adding clamped availability',
  async () => {
    const beneficiary = await user();
    const other = await user();
    const legacy = await db!.balanceLog.create({
      data: {
        userId: beneficiary.id,
        action: 'LEGACY',
        source: 'DOM',
        balanceDelta: 100,
        lockedDelta: 20,
      },
    });
    await db!.$transaction(async (tx) => {
      await applyWalletEntry(tx, {
        userId: beneficiary.id,
        action: 'TEST',
        source: 'TEST',
        platformTag: 'EBOOK',
        nature: 'SALE',
        balanceDelta: -90,
        lockedDelta: 10,
      });
      await applyWalletEntry(tx, {
        userId: other.id,
        action: 'TEST',
        source: 'TEST',
        platformTag: 'EBOOK',
        nature: 'SALE',
        balanceDelta: 999,
      });
    });
    const snapshot = await readWalletAttribution(db!, beneficiary.id);
    expect(snapshot.consistent).toBe(true);
    expect([
      snapshot.balance.toString(),
      snapshot.locked.toString(),
      snapshot.available.toString(),
    ]).toEqual(['10', '30', '0']);
    expect(
      snapshot.buckets.map((b) => [
        b.platformTag,
        b.nature,
        b.balance.toString(),
        b.locked.toString(),
      ]),
    ).toEqual([
      [null, null, '100', '20'],
      ['EBOOK', 'SALE', '-90', '10'],
    ]);
    const unchanged = await db!.balanceLog.findUniqueOrThrow({
      where: { id: legacy.id },
    });
    expect([
      unchanged.platformTag,
      unchanged.nature,
      unchanged.balanceDelta.toString(),
      unchanged.lockedDelta.toString(),
    ]).toEqual([null, null, '100', '20']);
    // Transferring administrative ownership must not reassign ledger beneficiaries.
    const platform = await db!.platform.create({
      data: {
        tag: `OWNERSHIP-${crypto.randomUUID()}`,
        name: 'History',
        ownerUserId: beneficiary.id,
      },
    });
    await db!.balanceLog.update({
      where: { id: legacy.id },
      data: { platformTag: platform.tag },
    });
    await db!.platform.update({
      where: { id: platform.id },
      data: { ownerUserId: other.id },
    });
    const historical = await readWalletAttribution(db!, beneficiary.id);
    expect(
      historical.buckets
        .find((b) => b.platformTag === platform.tag)
        ?.balance.toString(),
    ).toBe('100');
    expect(
      (await readWalletAttribution(db!, other.id)).buckets.some(
        (b) => b.platformTag === platform.tag,
      ),
    ).toBe(false);
    expect(
      (await readWalletAttribution(db!, beneficiary.id)).balance.toString(),
    ).toBe('10');
  },
);

run(
  'additive migration preserves historical deltas and leaves attribution unknown',
  async () => {
    const beneficiary = await user();
    await db!.balanceLog.create({
      data: {
        userId: beneficiary.id,
        action: 'LEGACY',
        source: 'TEST',
        balanceDelta: 12,
        lockedDelta: 3,
      },
    });
    const pg = new Client({ connectionString: url! });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      await pg.query(
        'ALTER TABLE "BalanceLog" DROP COLUMN "platformTag", DROP COLUMN "nature"',
      );
      await pg.query(
        readFileSync(
          resolve(
            import.meta.dir,
            '../prisma/migrations/20261101130000_balance_log_attribution/migration.sql',
          ),
          'utf8',
        ),
      );
      const result = await pg.query(
        'SELECT "platformTag", nature, "balanceDelta", "lockedDelta" FROM "BalanceLog" WHERE "userId" = $1',
        [beneficiary.id],
      );
      expect(result.rows).toEqual([
        {
          platformTag: null,
          nature: null,
          balanceDelta: '12.00',
          lockedDelta: '3.00',
        },
      ]);
    } finally {
      await pg.query('ROLLBACK');
      await pg.end();
    }
  },
);

run(
  'absolute setter classifies only its delta and omission stays unknown',
  async () => {
    const beneficiary = await user();
    await db!.$transaction((tx) =>
      applyWalletEntry(tx, {
        userId: beneficiary.id,
        action: 'TEST',
        source: 'TEST',
        balanceDelta: 50,
      }),
    );
    await db!.$transaction((tx) =>
      setWalletBalance(tx, {
        userId: beneficiary.id,
        action: 'TEST',
        source: 'TEST',
        balance: 70,
        platformTag: 'EBOOK',
        nature: 'ADJUSTMENT',
      }),
    );
    const snapshot = await readWalletAttribution(db!, beneficiary.id);
    expect(snapshot.consistent).toBe(true);
    expect(snapshot.buckets.map((b) => b.balance.toString())).toEqual([
      '50',
      '20',
    ]);
    await expect(
      db!.$transaction((tx) =>
        applyWalletEntry(tx, {
          userId: 'missing-user',
          action: 'TEST',
          source: 'TEST',
          balanceDelta: 1,
        }),
      ),
    ).rejects.toThrow();
  },
);

run(
  'empty beneficiary retains unknown bucket and cache drift is reported not repaired',
  async () => {
    const beneficiary = await user();
    const empty = await readWalletAttribution(db!, beneficiary.id);
    expect(empty.available.toString()).toBe('0');
    expect(empty.buckets).toHaveLength(1);
    expect(empty.wallet).toBeNull();
    await db!.$transaction((tx) =>
      applyWalletEntry(tx, {
        userId: beneficiary.id,
        action: 'TEST',
        source: 'TEST',
        balanceDelta: 10,
      }),
    );
    await db!.wallet.update({
      where: { userId: beneficiary.id },
      data: { balance: 20 },
    });
    const snapshot = await readWalletAttribution(db!, beneficiary.id);
    expect(snapshot.consistent).toBe(false);
    expect(snapshot.balance.toString()).toBe('10');
    expect(snapshot.wallet?.balance.toString()).toBe('20');
    // Restore deliberate drift so subsequent suites can install the fail-closed guard.
    await db!.wallet.update({
      where: { userId: beneficiary.id },
      data: { balance: 10 },
    });
  },
);
