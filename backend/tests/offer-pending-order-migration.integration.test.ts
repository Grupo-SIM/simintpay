import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Offer, PrismaClient } from '@prisma/client';
import { useEmptyCaches } from '../src/application/use-cases/payment-link/charge-characterization.fixture';
import { ProcessDomWebhookUseCase } from '../src/application/use-cases/webhook/process-dom-webhook.use-case';
import { openFinancialSubscriptionIn } from '../src/modules/financial-policy/financial-subscription';
import { priceOfferCharge } from '../src/modules/offer/offer-pricing';
import {
  runMigration,
  runVerify,
  snapshot,
} from '../scripts/offer-pending-order-migration';
import { seedGlobalPolicy } from './billing-policy-fixture';

const url = process.env.OFFER_PENDING_ORDER_MIGRATION_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db
  ? (name: string, fn: () => Promise<void>) => test(name, fn, 60_000)
  : test.skip;

const uid = () => crypto.randomUUID();
type Seeded = Awaited<ReturnType<typeof seed>>;
let s: Seeded;

async function seed(d: PrismaClient) {
  await seedGlobalPolicy(d);
  const seller = await d.user.create({
    data: { name: 'Seller', email: `seller-${uid()}@t.dev`, password: 'x' },
  });
  // Wallet guard: Wallet.balance must equal the BalanceLog sum at commit.
  await d.$transaction([
    d.wallet.create({ data: { userId: seller.id, balance: '100.00' } }),
    d.balanceLog.create({
      data: {
        userId: seller.id,
        action: 'CREDIT',
        balanceDelta: '100.00',
        lockedDelta: '0',
        source: 'test',
      },
    }),
  ]);
  const link = await d.subscriptionLink.create({
    data: {
      userId: seller.id,
      name: 'Anual',
      amount: '150.00',
      frequencyType: 'ANUAL',
    },
  });
  // The migrated offer keeps the legacy link id (offer-migration-apply).
  const offer = await d.offer.create({
    data: {
      id: link.id,
      ownerUserId: seller.id,
      createdByUserId: seller.id,
      code: uid().slice(0, 10).toUpperCase(),
      name: 'Plano anual',
      amountCents: 15000,
      acceptedMethods: ['PIX'],
      renewalMode: 'MANUAL_PAY',
      intervalType: 'YEAR',
      intervalCount: 1,
    } as never,
  });
  const pricing = await priceOfferCharge(
    d,
    null as never,
    offer as Offer,
    'PIX',
    1,
  );
  const order = (
    over: Record<string, unknown> & { email: string },
  ): Promise<Awaited<ReturnType<typeof d.subscriptionLinkOrder.create>>> => {
    const { email, ...rest } = over;
    return d.subscriptionLinkOrder.create({
      data: {
        subscriptionLinkId: link.id,
        userId: seller.id,
        customerName: 'Ana',
        customerEmail: email,
        customerDocument: '12345678909',
        paymentMethod: 'PIX',
        status: 'pending',
        domPixPaymentId: `pix-${uid()}`,
        pixContent: '000201pix',
        pixExpire: new Date('2099-01-01T00:00:00Z'),
        amountCharged: pricing.totalAmount,
        financialSnapshot: pricing.financialSnapshot as never,
        ...rest,
      } as never,
    });
  };
  const pendingA = await order({ email: `a-${uid()}@t.dev` });
  const duplicate = await order({
    email: pendingA.customerEmail.toUpperCase(),
  });
  const noPix = await order({
    email: `b-${uid()}@t.dev`,
    domPixPaymentId: null,
  });
  const noSnapshot = await order({
    email: `c-${uid()}@t.dev`,
    financialSnapshot: undefined,
  });
  const paid = await order({ email: `d-${uid()}@t.dev`, status: 'paid' });
  const expired = await order({ email: `e-${uid()}@t.dev`, status: 'expired' });
  // Already opened by the reconciliation (cab87666): must be adopted, not duplicated.
  const reconciled = await order({ email: `f-${uid()}@t.dev` });
  await d.$transaction((tx) =>
    openFinancialSubscriptionIn(tx, {
      snapshot: reconciled.financialSnapshot,
      amount: reconciled.amountCharged,
      paymentId: reconciled.domPixPaymentId!,
      userId: seller.id,
      method: 'PIX',
      name: 'Anual',
    }),
  );
  return {
    seller,
    offer,
    pricing,
    pendingA,
    duplicate,
    noPix,
    noSnapshot,
    paid,
    expired,
    reconciled,
  };
}

beforeAll(async () => {
  if (!db) return;
  await useEmptyCaches();
  s = await seed(db);
}, 120_000);
afterAll(async () => {
  await db?.$disconnect();
});

// The database may hold orders of earlier runs: only this scenario's orders are asserted.
const mine = (r: { migrated: { orderId: string }[] }) =>
  r.migrated.filter((m) =>
    [s.pendingA.id, s.reconciled.id, s.duplicate.id, s.noPix.id].includes(
      m.orderId,
    ),
  );
const migrate = () => db!.$transaction((tx) => runMigration(tx));
const decisionOf = (r: Awaited<ReturnType<typeof migrate>>, orderId: string) =>
  r.plans.find((p) => p.order.id === orderId)?.decision;
const contractOf = (orderId: string) =>
  db!.billingContract.findFirst({
    where: { metadata: { path: ['legacyOrderId'], equals: orderId } },
    include: { charges: { include: { transaction: true } } },
  });

run(
  'dry-run rolls back, leaving no contract, charge or transaction',
  async () => {
    const before = await snapshot(db! as never);
    class Rollback extends Error {}
    await db!
      .$transaction(async (tx) => {
        const r = await runMigration(tx);
        expect(mine(r)).toHaveLength(2);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    expect(await snapshot(db! as never)).toEqual(before);
    expect(await contractOf(s.pendingA.id)).toBeNull();
    const order = await db!.subscriptionLinkOrder.findUniqueOrThrow({
      where: { id: s.pendingA.id },
    });
    expect(order.status).toBe('pending');
  },
);

run('migrates pending Pix orders and reports the rest untouched', async () => {
  const walletBefore = await db!.wallet.findUniqueOrThrow({
    where: { userId: s.seller.id },
  });
  const logsBefore = await db!.balanceLog.count();
  const result = await migrate();

  expect(decisionOf(result, s.pendingA.id)).toBe('MIGRATE');
  expect(decisionOf(result, s.reconciled.id)).toBe('MIGRATE');
  expect(decisionOf(result, s.duplicate.id)).toBe('DUPLICATE_CONTRACT_KEY');
  expect(decisionOf(result, s.noPix.id)).toBe('NO_PIX_PAYMENT');
  expect(decisionOf(result, s.noSnapshot.id)).toBe('NO_FINANCIAL_SNAPSHOT');
  expect(decisionOf(result, s.paid.id)).toBeUndefined();
  expect(decisionOf(result, s.expired.id)).toBeUndefined();
  expect(result.ignored.map((r) => r.status)).toEqual(
    expect.arrayContaining(['expired', 'paid']),
  );

  const a = (await contractOf(s.pendingA.id))!;
  expect(a.status).toBe('INACTIVE');
  expect(a.offerId).toBe(s.offer.id);
  expect(a.resourceId).toBe(
    `${s.offer.id}:${s.pendingA.customerEmail.toLowerCase()}`,
  );
  expect(a.nextChargeAt).toEqual(a.currentPeriodEnd);
  expect(a.charges).toHaveLength(1);
  const [charge] = a.charges;
  expect(charge.status).toBe('PENDING');
  expect(charge.method).toBe('PIX');
  expect(charge.cycleKey).toBe(a.currentPeriodEnd.toISOString());
  expect(charge.amountCents).toBe(
    15000 + Math.round((s.pricing.totalAmount - 150) * 100),
  );
  const tx = charge.transaction!;
  expect(tx.status).toBe('PENDING');
  expect(tx.settlementBasis).toBe('FINAL_NET');
  expect(tx.offerId).toBe(s.offer.id);
  expect(tx.domPaymentId).toBe(s.pendingA.domPixPaymentId);
  expect(tx.pixContent).toBe('000201pix');
  expect(Number(tx.amount)).toBe(s.pricing.totalAmount);
  expect(
    (
      await db!.subscriptionLinkOrder.findUniqueOrThrow({
        where: { id: s.pendingA.id },
      })
    ).status,
  ).toBe('migrated');

  // The Transaction opened by the reconciliation is adopted, not duplicated.
  const f = (await contractOf(s.reconciled.id))!;
  expect(f.charges[0].transaction!.offerId).toBe(s.offer.id);
  expect(
    await db!.transaction.count({
      where: { domPaymentId: s.reconciled.domPixPaymentId },
    }),
  ).toBe(1);

  // Skipped and non-pending orders were not touched.
  for (const o of [s.duplicate, s.noPix, s.noSnapshot])
    expect(await contractOf(o.id)).toBeNull();
  for (const [o, status] of [
    [s.duplicate, 'pending'],
    [s.noPix, 'pending'],
    [s.noSnapshot, 'pending'],
    [s.paid, 'paid'],
    [s.expired, 'expired'],
  ] as const)
    expect(
      (
        await db!.subscriptionLinkOrder.findUniqueOrThrow({
          where: { id: o.id },
        })
      ).status,
    ).toBe(status);
  expect(
    await db!.transaction.count({
      where: { domPaymentId: s.paid.domPixPaymentId },
    }),
  ).toBe(0);

  const walletAfter = await db!.wallet.findUniqueOrThrow({
    where: { userId: s.seller.id },
  });
  expect(walletAfter.balance).toEqual(walletBefore.balance);
  expect(await db!.balanceLog.count()).toBe(logsBefore);
  expect(await runVerify(db! as never)).toEqual([]);
});

run('is idempotent: a second run migrates nothing new', async () => {
  const result = await migrate();
  const contracts = await db!.billingContract.count();
  const charges = await db!.charge.count();
  const transactions = await db!.transaction.count();
  await migrate();
  expect(mine(result)).toEqual([]);
  expect(await db!.billingContract.count()).toBe(contracts);
  expect(await db!.charge.count()).toBe(charges);
  expect(await db!.transaction.count()).toBe(transactions);
});

run('the DOM paid webhook settles through the offer path', async () => {
  const uc = new ProcessDomWebhookUseCase(
    db as never,
    {} as never,
    {
      applyForTransaction: async () => undefined,
      reverseForTransaction: async () => undefined,
    } as never,
  );
  const pixId = s.pendingA.domPixPaymentId!;
  const event = (signature: string) => ({
    event: 'transaction',
    signature,
    data: {
      id: pixId,
      status: 'paid',
      amount: Math.round(s.pricing.totalAmount * 100),
      payment_method: 'pix',
    },
  });
  const walletBefore = await db!.wallet.findUniqueOrThrow({
    where: { userId: s.seller.id },
  });

  await uc.execute(event(`sig-${uid()}`));

  const a = (await contractOf(s.pendingA.id))!;
  expect(a.charges[0].status).toBe('PAID');
  expect(a.charges[0].paidAt).not.toBeNull();
  expect(a.charges[0].transaction!.status).toBe('COMPLETED');
  expect(a.status).toBe('ACTIVE');
  expect(a.nextChargeAt).not.toBeNull();
  expect(a.currentPeriodEnd.getUTCFullYear()).toBe(
    a.currentPeriodStart.getUTCFullYear() + 1,
  );
  // The legacy handler did not run: the order was not flipped to paid.
  expect(
    (
      await db!.subscriptionLinkOrder.findUniqueOrThrow({
        where: { id: s.pendingA.id },
      })
    ).status,
  ).toBe('migrated');
  const walletAfter = await db!.wallet.findUniqueOrThrow({
    where: { userId: s.seller.id },
  });
  expect(
    Number(walletAfter.balance) - Number(walletBefore.balance),
  ).toBeCloseTo(Number(a.charges[0].transaction!.netAmount), 2);

  // A repeated webhook does not credit again nor move the contract.
  await uc.execute(event(`sig-${uid()}`));
  const again = (await contractOf(s.pendingA.id))!;
  expect(again.currentPeriodEnd).toEqual(a.currentPeriodEnd);
  expect(
    (await db!.wallet.findUniqueOrThrow({ where: { userId: s.seller.id } }))
      .balance,
  ).toEqual(walletAfter.balance);
  expect(await runVerify(db! as never)).toEqual([]);

  // A paid order is never picked up again.
  const result = await migrate();
  expect(mine(result)).toEqual([]);
});
