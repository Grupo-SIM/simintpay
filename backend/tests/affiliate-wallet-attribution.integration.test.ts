import { afterAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { readSellerWalletAttribution } from '../src/modules/platform-core/seller-wallet-attribution';

const url = process.env.AFFILIATE_READERS_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    new URL(url).pathname !== '/affiliate_readers_fixture')
) {
  throw new Error(
    'Only dedicated local disposable affiliate fixture database allowed',
  );
}
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  if (db) {
    await db.$executeRawUnsafe(
      'DROP TABLE IF EXISTS "BalanceLog", "Wallet", "User"',
    );
    await db.$disconnect();
  }
});
(url ? test : test.skip)(
  'affiliate beneficiary attribution preserves signed aliases and blocks unknown net-zero history',
  async () => {
    // This disposable database deliberately contains only the tables queried by
    // the shared reader. No application migrations, guards or money actions run.
    await db!.$executeRawUnsafe('CREATE TABLE "User" (id text PRIMARY KEY)');
    await db!.$executeRawUnsafe(
      'CREATE TABLE "Wallet" ("userId" text, balance numeric, "lockedBalance" numeric)',
    );
    await db!.$executeRawUnsafe(
      'CREATE TABLE "BalanceLog" (id text, "userId" text, "platformTag" text, nature text, "balanceDelta" numeric, "lockedDelta" numeric)',
    );
    await db!.$executeRawUnsafe(`INSERT INTO "User" VALUES ('beneficiary')`);
    await db!.$executeRawUnsafe(
      `INSERT INTO "Wallet" VALUES ('beneficiary', -5, 2)`,
    );
    await db!.$executeRawUnsafe(
      `INSERT INTO "BalanceLog" VALUES ('one','beneficiary','EBOOKSIM','ORDINARY',10,2),('two','beneficiary','EBOOK','ORDINARY',-15,0)`,
    );
    const result = await readSellerWalletAttribution(
      db!,
      ['beneficiary', 'beneficiary'],
      'EBOOK',
    );
    expect(result.size).toBe(1);
    expect(result.get('beneficiary')?.balance).toBe(-5);
    expect(result.get('beneficiary')?.lockedBalance).toBe(2);
    await db!.$executeRawUnsafe(
      `INSERT INTO "BalanceLog" VALUES ('unknown-one','beneficiary',NULL,'ORDINARY',5,0),('unknown-two','beneficiary',NULL,'ORDINARY',-5,0)`,
    );
    expect(
      (await readSellerWalletAttribution(db!, ['beneficiary'], 'EBOOK')).get(
        'beneficiary',
      )?.balance,
    ).toBeNull();
  },
  60_000,
);
