import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { BillingCycleService } from '../src/modules/billing-core/billing-cycle.service';
import { ChargeReconciler } from '../src/modules/billing-core/charge-reconciler.service';
import type {
  ChargeLookupResult,
  ChargeStatusLookup,
} from '../src/modules/billing-core/charge-status-lookup';
import { seedGlobalPolicy } from './billing-policy-fixture';
import { giveStoredCard } from './stored-card-fixture';

const url = process.env.BILLING_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db
  ? (name: string, fn: () => Promise<void>) => test(name, fn, 30_000)
  : test.skip;
const hour = 60 * 60 * 1000;
const t0 = new Date('2026-01-01T00:00:00.000Z');
let service: BillingCycleService;
let ownerId: string;

class FakeLookup implements ChargeStatusLookup {
  calls: { chargeId: string; attempts: number }[] = [];
  constructor(private answer: ChargeLookupResult | Error) {}
  async find(chargeId: string, attempts: number) {
    this.calls.push({ chargeId, attempts });
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

/** A contract whose cycle charge was left PENDING by an UNKNOWN executor outcome. */
async function pendingUnknown(email: string) {
  const offer = await db!.offer.create({
    data: {
      ownerUserId: ownerId,
      createdByUserId: ownerId,
      code: `OFF-${crypto.randomUUID()}`,
      kind: 'PLAN',
      name: 'Plano',
      amountCents: 5000,
      acceptedMethods: ['CREDIT_CARD'],
      renewalMode: 'AUTO_CHARGE',
      intervalType: 'MONTH',
      intervalCount: 1,
      retryDays: 3,
      graceDays: 7,
    },
  });
  const { contract, charge } = await service.subscribe({
    offerId: offer.id,
    customerName: 'Buyer',
    customerEmail: email,
    now: t0,
  });
  await service.settle(charge.id, 'PAID', t0);
  await giveStoredCard(db!, contract);
  await service.runDue(new Date(t0.getTime() + 31 * 24 * hour), {
    charge: async () => ({ outcome: 'UNKNOWN' as const }),
  });
  const pending = await db!.charge.findFirstOrThrow({
    where: { contractId: contract.id, status: 'PENDING' },
  });
  return { contract, pending };
}

function reconciler(lookup: ChargeStatusLookup) {
  return new ChargeReconciler(db as never, service, lookup);
}

beforeAll(async () => {
  if (!db) return;
  service = new BillingCycleService(db as never);
  await seedGlobalPolicy(db);
  ownerId = (
    await db.user.create({
      data: {
        name: 'Seller',
        email: `seller-${crypto.randomUUID()}@test.dev`,
        password: 'x',
      },
    })
  ).id;
});
afterAll(async () => {
  await db?.$disconnect();
});

run('PAID lookup settles the charge once, booking the ledger', async () => {
  const { contract, pending } = await pendingUnknown('rec-paid@test.dev');
  const lookup = new FakeLookup('PAID');
  const now = new Date(pending.dueAt!.getTime() + 2 * hour);
  const first = await reconciler(lookup).run(now);
  expect(first.paid).toBeGreaterThanOrEqual(1);
  expect(lookup.calls.find((c) => c.chargeId === pending.id)?.attempts).toBe(
    pending.attempts,
  );
  const settled = await db!.charge.findUniqueOrThrow({
    where: { id: pending.id },
  });
  expect(settled.status).toBe('PAID');
  expect(settled.transactionId).not.toBeNull();
  await reconciler(lookup).run(now);
  expect(
    await db!.charge.count({
      where: { contractId: contract.id, transactionId: { not: null } },
    }),
  ).toBe(2);
});

run('FAILED lookup fails the charge and moves the contract on', async () => {
  const { contract, pending } = await pendingUnknown('rec-failed@test.dev');
  await reconciler(new FakeLookup('FAILED')).run(
    new Date(pending.dueAt!.getTime() + 2 * hour),
  );
  expect(
    (await db!.charge.findUniqueOrThrow({ where: { id: pending.id } })).status,
  ).toBe('FAILED');
  expect(
    (
      await db!.billingContract.findUniqueOrThrow({
        where: { id: contract.id },
      })
    ).status,
  ).toBe('PAST_DUE');
});

run('UNKNOWN or a throwing lookup leaves the charge PENDING', async () => {
  const { contract, pending } = await pendingUnknown('rec-unknown@test.dev');
  const now = new Date(pending.dueAt!.getTime() + 2 * hour);
  const before = await db!.billingContract.findUniqueOrThrow({
    where: { id: contract.id },
  });
  await reconciler(new FakeLookup('UNKNOWN')).run(now);
  await reconciler(new FakeLookup(new Error('timeout'))).run(now);
  expect(
    (await db!.charge.findUniqueOrThrow({ where: { id: pending.id } })).status,
  ).toBe('PENDING');
  const after = await db!.billingContract.findUniqueOrThrow({
    where: { id: contract.id },
  });
  expect(after.version).toBe(before.version);
  expect(
    await db!.billingContractEvent.count({
      where: { contractId: contract.id, type: 'CHARGE_UNRESOLVED' },
    }),
  ).toBe(0);
});

run('NOT_FOUND fails only after the acquirer-lag grace', async () => {
  const { pending } = await pendingUnknown('rec-nf@test.dev');
  const lookup = new FakeLookup('NOT_FOUND');
  await reconciler(lookup).run(
    new Date(pending.dueAt!.getTime() + 30 * 60_000),
  );
  expect(
    (await db!.charge.findUniqueOrThrow({ where: { id: pending.id } })).status,
  ).toBe('PENDING');
  await reconciler(lookup).run(new Date(pending.dueAt!.getTime() + 2 * hour));
  expect(
    (await db!.charge.findUniqueOrThrow({ where: { id: pending.id } })).status,
  ).toBe('FAILED');
});

run('still UNKNOWN after 48h is flagged CHARGE_UNRESOLVED once', async () => {
  const { contract, pending } = await pendingUnknown('rec-stale@test.dev');
  const lookup = new FakeLookup('UNKNOWN');
  const young = new Date(pending.dueAt!.getTime() + 47 * hour);
  await reconciler(lookup).run(young);
  expect(
    await db!.billingContractEvent.count({
      where: { contractId: contract.id, type: 'CHARGE_UNRESOLVED' },
    }),
  ).toBe(0);
  const stale = new Date(pending.dueAt!.getTime() + 49 * hour);
  const first = await reconciler(lookup).run(stale);
  const second = await reconciler(lookup).run(stale);
  expect(first.flagged).toBeGreaterThanOrEqual(1);
  expect(second.flagged).toBe(0);
  const events = await db!.billingContractEvent.findMany({
    where: { contractId: contract.id, type: 'CHARGE_UNRESOLVED' },
  });
  expect(events.length).toBe(1);
  expect(events[0]!.payload).toMatchObject({ chargeId: pending.id });
  expect(
    (await db!.charge.findUniqueOrThrow({ where: { id: pending.id } })).status,
  ).toBe('PENDING');
});
