import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import {
  readWalletAttribution,
  selectWalletPlatformAttribution,
} from '../src/modules/wallet-ledger/wallet-attribution';
import { applyWalletEntry } from '../src/modules/wallet-ledger/wallet-ledger';

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
    await pg.query(
      readFileSync(
        resolve(
          import.meta.dir,
          '../prisma/migrations/20261031130000_balance_log_drives_wallet/migration.sql',
        ),
        'utf8',
      ),
    );
  } finally {
    await pg.end();
  }
});
afterAll(async () => {
  await db?.$disconnect();
});
const run = (name: string, body: () => Promise<void>) =>
  (url ? test : test.skip)(name, body);
async function user() {
  return db!.user.create({
    data: {
      email: `completeness-${crypto.randomUUID()}@test.local`,
      password: 'test',
      name: 'Completeness',
    },
  });
}

run(
  'net-zero unknown history counts real rows, not synthetic buckets or monetary totals',
  async () => {
    const owner = await user();
    for (const [index, balanceDelta] of [10, -10].entries()) {
      await db!.$transaction((tx) =>
        applyWalletEntry(tx, {
          userId: owner.id,
          balanceDelta,
          action: 'COMPLETENESS',
          description: 'unknown',
          source: `COMPLETENESS_A_${index}`,
        }),
      );
    }
    const result = await readWalletAttribution(db!, owner.id);
    expect(result.balance.toString()).toBe('0');
    expect(result.rowCount).toBe(2);
    expect(result.unknownPlatformHistory).toBe(2);
    expect(result.unknownNatureHistory).toBe(2);
    expect(result.historicalAttributionComplete).toBe(false);
    expect(result.ledgerStatus).toBe('present');
    expect(result.walletStatus).toBe('consistent');
  },
);

run(
  'selector sums signed multiple sources and natures without spendable claims',
  async () => {
    const owner = await user();
    for (const [index, balanceDelta] of [20, -35].entries()) {
      await db!.$transaction((tx) =>
        applyWalletEntry(tx, {
          userId: owner.id,
          balanceDelta,
          lockedDelta: index ? 2 : 0,
          action: 'COMPLETENESS',
          description: 'signed',
          source: `COMPLETENESS_${index}`,
          platformTag: 'EBOOK',
          nature: index ? 'ADJUSTMENT' : 'SALE',
        }),
      );
    }
    await db!.$transaction((tx) =>
      applyWalletEntry(tx, {
        userId: owner.id,
        balanceDelta: 40,
        action: 'COMPLETENESS',
        description: 'other',
        source: 'COMPLETENESS_OTHER',
        platformTag: 'DELIVERY',
        nature: 'SALE',
      }),
    );
    const result = await readWalletAttribution(db!, owner.id);
    expect(result.rowCount).toBe(3);
    expect(
      result.buckets.find((bucket) => bucket.platformTag === null)?.rowCount,
    ).toBe(0);
    expect(result.historicalAttributionComplete).toBe(true);
    expect(result.available.toString()).toBe('23');
    const selected = selectWalletPlatformAttribution(result, ' ebooksIM ');
    expect(selected.platformTag).toBe('EBOOK');
    expect(selected.balance.toString()).toBe('-15');
    expect(selected.locked.toString()).toBe('2');
    expect(selected.rowCount).toBe(2);
    expect(selected.pooledWallet?.balance.toString()).toBe('25');
    expect('available' in selected).toBe(false);
    expect(selectWalletPlatformAttribution(result, 'absent').rowCount).toBe(0);
    expect(() => selectWalletPlatformAttribution(result, '')).toThrow();
  },
);

run(
  'missing ledger, zero legacy wallet, missing wallet and mismatch remain distinct',
  async () => {
    const owner = await user();
    const missing = await readWalletAttribution(db!, owner.id);
    expect(missing.walletStatus).toBe('missing');
    expect(missing.ledgerStatus).toBe('missing');
    expect(missing.consistent).toBe(false);
    expect(missing.rowCount).toBe(0);
    expect(missing.buckets[0].rowCount).toBe(0);
    expect(
      selectWalletPlatformAttribution(missing, 'EBOOK').pooledWallet,
    ).toBeNull();
    await db!.wallet.create({
      data: { userId: owner.id, balance: 0, lockedBalance: 0 },
    });
    const zero = await readWalletAttribution(db!, owner.id);
    expect(zero.ledgerStatus).toBe('missing');
    expect(zero.walletStatus).toBe('consistent');
    await db!.wallet.update({
      where: { userId: owner.id },
      data: { balance: 7 },
    });
    const mismatch = await readWalletAttribution(db!, owner.id);
    expect(mismatch.walletStatus).toBe('mismatch');
    expect(mismatch.wallet?.balance.toString()).toBe('7');
    expect(mismatch.balance.toString()).toBe('0');
    await db!.wallet.update({
      where: { userId: owner.id },
      data: { balance: 0 },
    });
  },
);
