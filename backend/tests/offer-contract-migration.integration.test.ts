import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  diffSnapshots,
  runMigration,
  runVerify,
  snapshot,
} from '../scripts/offer-contract-migration';
import { seedScenario } from './offer-contract-migration-fixture';

const url = process.env.OFFER_CONTRACT_MIGRATION_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;

let scenario: Awaited<ReturnType<typeof seedScenario>>;

const migrate = () => db!.$transaction((tx) => runMigration(tx));

beforeAll(async () => {
  if (!db) return;
  scenario = await seedScenario(db);
}, 60_000);
afterAll(async () => {
  await db?.$disconnect();
});

const contractOf = (orderId: string) =>
  db!.billingContract.findFirst({
    where: { metadata: { path: ['legacyOrderId'], equals: orderId } },
    include: { charges: true },
  });

run('migrates the eligible paid PIX orders and skips the rest', async () => {
  const before = await snapshot(db! as never);
  const result = await migrate();
  expect(result.contracts).toBeGreaterThanOrEqual(4);
  expect(diffSnapshots(before, await snapshot(db! as never))).toEqual([]);

  const { rows, offer } = scenario;
  const active = (await contractOf(rows.active.order.id))!;
  expect(active.status).toBe('ACTIVE');
  expect(active.resourceType).toBe('OFFER');
  expect(active.resourceId).toBe(
    `${offer.id}:${rows.active.order.customerEmail.toLowerCase()}`,
  );
  expect(active.nextChargeAt).toEqual(active.currentPeriodEnd);
  expect(active.externalSubscriptionId).toBeNull();
  expect(active.userId).toBe(offer.ownerUserId);
  expect(active.charges).toHaveLength(1);
  const charge = active.charges[0];
  expect(charge.status).toBe('PAID');
  expect(charge.transactionId).toBe(rows.active.transaction.id);
  expect(charge.amountCents).toBe(19990);
  expect(charge.cycleKey).toBe(active.currentPeriodStart.toISOString());
  expect(charge.periodEnd).toEqual(active.currentPeriodEnd);

  const expired = (await contractOf(rows.expired.order.id))!;
  expect(expired.status).toBe('SUSPENDED');
  expect(expired.nextChargeAt).toBeNull();
  expect(expired.accessEndsAt).toEqual(expired.currentPeriodEnd);

  // Same calendar overflow as advanceInterval: Feb 29 + 1 year = Mar 1.
  const leap = (await contractOf(rows.leap.order.id))!;
  expect(leap.currentPeriodEnd.toISOString()).toBe('2025-03-01T12:00:00.123Z');

  expect(await contractOf(rows.noOffer.order.id)).toBeNull();
  expect(await contractOf(rows.card.order.id)).toBeNull();
  expect(await contractOf(rows.pendingTx.order.id)).toBeNull();
  expect(await contractOf(rows.dupSecond.order.id)).toBeNull();
  expect(await contractOf(rows.dupFirst.order.id)).not.toBeNull();
  expect(
    await db!.billingContract.count({
      where: {
        offerId: offer.id,
        customerEmail: rows.dupFirst.order.customerEmail,
      },
    }),
  ).toBe(1);
});

run('is idempotent and verify passes', async () => {
  const contracts = await db!.billingContract.count();
  const charges = await db!.charge.count();
  const again = await migrate();
  expect(again.contracts).toBe(0);
  expect(again.charges).toBe(0);
  expect(await db!.billingContract.count()).toBe(contracts);
  expect(await db!.charge.count()).toBe(charges);
  expect(await db!.$transaction((tx) => runVerify(tx))).toEqual([]);
});

run('verify catches tampering', async () => {
  const charge = (await contractOf(scenario.rows.active.order.id))!.charges[0];
  await db!.charge.update({
    where: { id: charge.id },
    data: { amountCents: charge.amountCents + 1 },
  });
  const rows = await db!.$transaction((tx) => runVerify(tx));
  expect(rows.map((r) => r.check)).toContain('AMOUNT_MISMATCH');
  await db!.charge.update({
    where: { id: charge.id },
    data: { amountCents: charge.amountCents },
  });
  expect(await db!.$transaction((tx) => runVerify(tx))).toEqual([]);
});
