import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const url = process.env.BILLING_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db
  ? (name: string, fn: () => Promise<void>) => test(name, fn, 120_000)
  : test.skip;

afterAll(async () => {
  await db?.$disconnect();
});

const migrationSql = readFileSync(
  new URL(
    '../prisma/migrations/20261118110000_transaction_offer_id/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const backfill = migrationSql
  .split('\n')
  .filter((line) => !line.startsWith('--'))
  .join('\n')
  .split(';')
  .map((statement) => statement.trim())
  .filter((statement) => statement.startsWith('UPDATE'));

run(
  'backfill fills offerId from the legacy link id and from the charge',
  async () => {
    const suffix = crypto.randomUUID();
    const user = await db!.user.create({
      data: { name: 'u', email: `u-${suffix}@test.dev`, password: 'x' },
    });
    const link = await db!.paymentLink.create({
      data: { userId: user.id, code: `L-${suffix}`, title: 'l', amount: 10 },
    });
    const pending = await db!.paymentLink.create({
      data: { userId: user.id, code: `P-${suffix}`, title: 'p', amount: 10 },
    });
    const offer = (id: string, code: string) =>
      db!.offer.create({
        data: {
          id,
          ownerUserId: user.id,
          createdByUserId: user.id,
          code,
          name: 'o',
          amountCents: 1000,
        },
      });
    await offer(link.id, `OL-${suffix}`);
    const cycleOffer = await offer(crypto.randomUUID(), `OC-${suffix}`);
    const tx = (paymentLinkId?: string) =>
      db!.transaction.create({
        data: { userId: user.id, amount: 10, paymentLinkId },
      });
    const viaLink = await tx(link.id);
    const unmigrated = await tx(pending.id);
    const viaCharge = await tx();
    await db!.charge.create({
      data: {
        offerId: cycleOffer.id,
        ownerUserId: user.id,
        amountCents: 1000,
        transactionId: viaCharge.id,
      },
    });

    for (let pass = 0; pass < 2; pass++)
      for (const statement of backfill) await db!.$executeRawUnsafe(statement);

    const read = async (id: string) =>
      (await db!.transaction.findUnique({ where: { id } }))!.offerId;
    expect(await read(viaLink.id)).toBe(link.id);
    expect(await read(unmigrated.id)).toBeNull();
    expect(await read(viaCharge.id)).toBe(cycleOffer.id);
  },
);
