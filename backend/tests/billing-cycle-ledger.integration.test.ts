import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { BillingCycleService } from '../src/modules/billing-core/billing-cycle.service';
import { seedGlobalPolicy } from './billing-policy-fixture';

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

async function firstCharge(offerId: string, email: string) {
  const { charge } = await service.subscribe({
    offerId,
    customerName: 'Buyer',
    customerEmail: email,
    now: t0,
  });
  return charge;
}

beforeAll(async () => {
  if (!db) return;
  service = new BillingCycleService(db as never);
  await seedGlobalPolicy(db);
});
afterAll(async () => {
  await db?.$disconnect();
});

run(
  'paid cycle books one Transaction, credits the wallet once and freezes the snapshot',
  async () => {
    const owner = await newUser('seller');
    const offer = await newOffer(owner.id, ['CREDIT_CARD']);
    const charge = await firstCharge(offer.id, 'ledger@test.dev');

    expect((await service.settle(charge.id, 'PAID', t0)).applied).toBe(true);
    const paid = await db!.charge.findUniqueOrThrow({
      where: { id: charge.id },
    });
    expect(paid.status).toBe('PAID');
    expect(paid.method).toBe('CREDIT_CARD');
    expect(paid.transactionId).not.toBeNull();
    expect(paid.snapshot).toMatchObject({
      method: 'CREDIT_CARD',
      financial: { key: 'DOM/CREDIT_CARD/ONLINE/1', originalCents: 10_000 },
    });

    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: paid.transactionId! },
    });
    expect(tx.status).toBe('COMPLETED');
    expect(tx.settlementBasis).toBe('FINAL_NET');
    expect(tx.userId).toBe(owner.id);
    // Default owner rule passes the 3% + R$1.00 cost to the buyer: seller keeps the offer price.
    expect(Number(tx.amount)).toBe(104);
    expect(Number(tx.netAmount)).toBe(100);
    expect(Number(tx.totalFee)).toBe(4);

    const wallet = await db!.wallet.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    expect(Number(wallet.balance)).toBe(100);
    expect(
      await db!.balanceLog.count({ where: { transactionId: tx.id } }),
    ).toBe(1);
  },
);

run(
  'duplicate settle never creates a second Transaction or credit',
  async () => {
    const owner = await newUser('seller');
    const offer = await newOffer(owner.id, ['CREDIT_CARD']);
    const charge = await firstCharge(offer.id, 'dup-ledger@test.dev');

    const results = await Promise.all([
      service.settle(charge.id, 'PAID', t0),
      service.settle(charge.id, 'PAID', t0),
    ]);
    expect(results.filter((r) => r.applied).length).toBe(1);
    await service.settle(charge.id, 'PAID', t0);

    expect(await db!.transaction.count({ where: { userId: owner.id } })).toBe(
      1,
    );
    const wallet = await db!.wallet.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    expect(Number(wallet.balance)).toBe(100);
  },
);

run('failed or unpaid charges create no Transaction', async () => {
  const owner = await newUser('seller');
  const offer = await newOffer(owner.id, ['CREDIT_CARD']);
  const charge = await firstCharge(offer.id, 'failed-ledger@test.dev');
  await service.settle(charge.id, 'FAILED', t0);
  expect(await db!.transaction.count({ where: { userId: owner.id } })).toBe(0);
  expect(
    (await db!.charge.findUniqueOrThrow({ where: { id: charge.id } }))
      .transactionId,
  ).toBeNull();
});

run('PIX offers are quoted with the PIX lane', async () => {
  const owner = await newUser('seller');
  const offer = await newOffer(owner.id, ['PIX']);
  const charge = await firstCharge(offer.id, 'pix-ledger@test.dev');
  await service.settle(charge.id, 'PAID', t0);
  const paid = await db!.charge.findUniqueOrThrow({ where: { id: charge.id } });
  const tx = await db!.transaction.findUniqueOrThrow({
    where: { id: paid.transactionId! },
  });
  expect(tx.paymentMethod).toBe('PIX');
  // PIX lane fee goes on top of the buyer total.
  expect(Number(tx.amount)).toBeGreaterThan(100);
  expect(Number(tx.netAmount)).toBe(100);
});

run(
  'offer coproduction is captured in the snapshot and allocated from the net',
  async () => {
    const owner = await newUser('seller');
    const partner = await newUser('partner');
    const offer = await newOffer(owner.id, ['CREDIT_CARD']);
    await db!
      .$executeRaw`INSERT INTO "CoproductionAgreement" (product, "productId", version, participants, "actorId", mode)
      VALUES ('ofertas', ${offer.id}, 1, ${JSON.stringify([{ userId: partner.id, percentageBps: 2500 }])}::jsonb, ${owner.id}, 'OWN')`;
    const charge = await firstCharge(offer.id, 'coprod-ledger@test.dev');
    await service.settle(charge.id, 'PAID', t0);

    const paid = await db!.charge.findUniqueOrThrow({
      where: { id: charge.id },
    });
    expect(paid.snapshot).toMatchObject({
      financial: {
        coproduction: { product: 'ofertas', productId: offer.id },
      },
    });
    const allocations = await db!.$queryRaw<
      { userId: string; amount: string; state: string }[]
    >`SELECT "userId", amount, state FROM "CoproductionAllocation" WHERE "transactionId" = ${paid.transactionId}`;
    const partnerShare = allocations.find((a) => a.userId === partner.id);
    expect(partnerShare?.state).toBe('AVAILABLE');
    expect(Number(partnerShare?.amount)).toBe(25);
    const ownerWallet = await db!.wallet.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    expect(Number(ownerWallet.balance)).toBe(75);
  },
);
