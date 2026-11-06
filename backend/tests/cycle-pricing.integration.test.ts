import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { BillingCycleService } from '../src/modules/billing-core/billing-cycle.service';
import { priceOfferCycle } from '../src/modules/billing-core/cycle-pricing';
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
const t0 = new Date('2026-01-01T00:00:00.000Z');
let service: BillingCycleService;

async function newUser(label: string) {
  return db!.user.create({
    data: {
      name: label,
      email: `${label}-${crypto.randomUUID()}@test.dev`,
      password: 'x',
    },
  });
}

async function newOffer(ownerId: string, methods: ('PIX' | 'CREDIT_CARD')[]) {
  return db!.offer.create({
    data: {
      ownerUserId: ownerId,
      createdByUserId: ownerId,
      code: `OFF-${crypto.randomUUID()}`,
      kind: 'PLAN',
      name: 'Plano',
      amountCents: 10_000,
      acceptedMethods: methods,
      renewalMode: methods[0] === 'PIX' ? 'MANUAL_PAY' : 'AUTO_CHARGE',
      intervalType: 'MONTH',
      intervalCount: 1,
    },
  });
}

beforeAll(async () => {
  if (!db) return;
  service = new BillingCycleService(db as never);
  await seedGlobalPolicy(db);
});
afterAll(async () => {
  await db?.$disconnect();
});

async function activate(offerId: string, email: string) {
  const { contract, charge } = await service.subscribe({
    offerId,
    customerName: 'Buyer',
    customerEmail: email,
    now: t0,
  });
  await service.settle(charge.id, 'PAID', t0);
  await giveStoredCard(db!, contract);
  return charge;
}

const monthLater = (n: number) => new Date(t0.getTime() + n * 31 * 86_400_000);

run(
  'every cycle bills the same buyer total and the ledger nets back to the base',
  async () => {
    const owner = await newUser('seller');
    const offer = await newOffer(owner.id, ['CREDIT_CARD']);
    const expected = await priceOfferCycle(
      db as never,
      offer,
      'CREDIT_CARD',
      1,
    );
    expect(expected.totalAmount).toBeGreaterThan(100);
    const first = await activate(offer.id, 'c1@test.dev');
    const totals = [first.amountCents];
    // The first charge from subscribe() is the legacy base; real checkout writes the total.
    await db!.charge.update({
      where: { id: first.id },
      data: { amountCents: Math.round(expected.totalAmount * 100) },
    });
    totals[0] = Math.round(expected.totalAmount * 100);
    for (const n of [1, 2]) {
      const now = monthLater(n);
      const contract = await db!.billingContract.findFirstOrThrow({
        where: { offerId: offer.id },
      });
      await db!.billingContract.update({
        where: { id: contract.id },
        data: {
          nextChargeAt: now,
          currentPeriodEnd: new Date(now.getTime() - 1),
        },
      });
      const res = await service.runDue(now, {
        charge: async () => ({ outcome: 'PAID' as const }),
      });
      expect(res.autoPaid).toBeGreaterThanOrEqual(1);
      const cycle = await db!.charge.findFirstOrThrow({
        where: { contractId: contract.id, status: 'PAID' },
        orderBy: { createdAt: 'desc' },
      });
      totals.push(cycle.amountCents);
      const tx = await db!.transaction.findUniqueOrThrow({
        where: { id: cycle.transactionId! },
      });
      expect(Number(tx.amount)).toBe(cycle.amountCents / 100);
      expect(Number(tx.netAmount) + Number(tx.totalFee)).toBeCloseTo(
        Number(tx.amount),
        2,
      );
      expect(Number(tx.netAmount)).toBe(100);
    }
    expect(totals[1]).toBe(totals[0]);
    expect(totals[2]).toBe(totals[0]);
  },
);

run(
  'a new cycle uses the new policy; a reopened charge keeps its frozen snapshot',
  async () => {
    const owner = await newUser('seller');
    const offer = await newOffer(owner.id, ['CREDIT_CARD']);
    await activate(offer.id, 'c2@test.dev');
    const contract = await db!.billingContract.findFirstOrThrow({
      where: { offerId: offer.id },
    });
    const failing = { charge: async () => ({ outcome: 'FAILED' as const }) };
    const due = (now: Date) =>
      db!.billingContract.update({
        where: { id: contract.id },
        data: { nextChargeAt: now },
      });
    const before = await priceOfferCycle(db as never, offer, 'CREDIT_CARD', 1);
    const t1 = monthLater(1);
    await due(t1);
    await service.runDue(t1, failing);
    const c2 = await db!.charge.findFirstOrThrow({
      where: { contractId: contract.id, status: 'FAILED' },
    });
    expect(c2.amountCents).toBe(Math.round(before.totalAmount * 100));

    // Policy changes: card rate 3% -> 5%.
    const rev = await db!.financialPolicyRevision.findFirstOrThrow({
      where: { tag: 'GLOBAL', version: 1 },
    });
    const original = rev.document as any;
    const changed = JSON.parse(JSON.stringify(original));
    changed.lanes['DOM/CREDIT_CARD/ONLINE/1'].contract.ratePpm = 50_000;
    changed.lanes['DOM/CREDIT_CARD/ONLINE/1'].sim.ratePpm = 50_000;
    await db!.financialPolicyRevision.update({
      where: { id: rev.id },
      data: { document: changed },
    });
    try {
      // Retry of the failed charge: frozen amount and snapshot unchanged.
      await due(t1);
      await service.runDue(t1, {
        charge: async () => ({ outcome: 'UNKNOWN' as const }),
      });
      const retried = await db!.charge.findUniqueOrThrow({
        where: { id: c2.id },
      });
      expect(retried.attempts).toBe(2);
      expect(retried.amountCents).toBe(c2.amountCents);
      expect(retried.snapshot).toEqual(c2.snapshot);
      await service.settle(c2.id, 'PAID', t1);
      const booked = await db!.charge.findUniqueOrThrow({
        where: { id: c2.id },
      });
      const tx2 = await db!.transaction.findUniqueOrThrow({
        where: { id: booked.transactionId! },
      });
      expect(Number(tx2.amount)).toBe(c2.amountCents / 100);

      // Next cycle is priced under the new policy.
      const t2 = monthLater(2);
      await due(t2);
      await db!.billingContract.update({
        where: { id: contract.id },
        data: { currentPeriodEnd: new Date(t2.getTime() - 1) },
      });
      await service.runDue(t2, failing);
      const c3 = await db!.charge.findFirstOrThrow({
        where: {
          contractId: contract.id,
          id: { not: c2.id },
          status: 'FAILED',
        },
        orderBy: { createdAt: 'desc' },
      });
      const after = await priceOfferCycle(db as never, offer, 'CREDIT_CARD', 1);
      expect(after.totalAmount).toBeGreaterThan(before.totalAmount);
      expect(c3.amountCents).toBe(Math.round(after.totalAmount * 100));
    } finally {
      await db!.financialPolicyRevision.update({
        where: { id: rev.id },
        data: { document: original },
      });
    }
  },
);
