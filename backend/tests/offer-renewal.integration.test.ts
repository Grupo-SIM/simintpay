import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { useEmptyCaches } from '../src/application/use-cases/payment-link/charge-characterization.fixture';
import { Acquirer } from '../src/core/services/acquirer.enum';
import { acquirerCapabilities } from '../src/core/services/acquirer-capabilities';
import { BillingCycleService } from '../src/modules/billing-core/billing-cycle.service';
import { markChargeSettled } from '../src/modules/billing-core/charge-settlement';
import { ExternalRefService } from '../src/modules/billing-core/external-ref.service';
import { signRenewal } from '../src/modules/billing-core/renewal-signature';
import { OfferRenewalService } from '../src/modules/offer/offer-renewal.service';
import { settleFinalNet } from '../src/modules/platform-core/link-settlement';
import { seedGlobalPolicy } from './billing-policy-fixture';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db
  ? (name: string, fn: () => Promise<void>) => test(name, fn, 60_000)
  : test.skip;

const day = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-01-01T00:00:00.000Z');
const at = (days: number) => new Date(t0.getTime() + days * day);

let ownerId: string;
let pixCalls = 0;
let pixExpire = '2099-01-01T00:00:00Z';
const gateway: any = {
  createPaymentLink: async () => ({ id: `link-${crypto.randomUUID()}` }),
  chargePixForLink: async (_t: string, input: any) => {
    pixCalls++;
    // Small delay so concurrent callers really overlap.
    await new Promise((r) => setTimeout(r, 50));
    return {
      id: `dom-pix-${crypto.randomUUID()}`,
      status: 'pending',
      pixContent: `000201${crypto.randomUUID()}`,
      qrCode: 'qr',
      pixExpire,
      amount: input.amount,
    };
  },
};
const resolver: any = {
  acquirerForSlug: () => Acquirer.DOM,
  capabilitiesFor: () => acquirerCapabilities(Acquirer.DOM),
  byAcquirer: () => gateway,
};
let billing: BillingCycleService;
let renewals: OfferRenewalService;

async function offer(over: Record<string, unknown> = {}) {
  return db!.offer.create({
    data: {
      ownerUserId: ownerId,
      createdByUserId: ownerId,
      code: `R${crypto.randomUUID().slice(0, 9).toUpperCase()}`,
      name: 'Plano',
      amountCents: 10000,
      acceptedMethods: ['PIX'],
      renewalMode: 'MANUAL_PAY',
      intervalType: 'MONTH',
      intervalCount: 1,
      retryDays: 3,
      graceDays: 7,
      ...over,
    } as never,
  });
}

/** A contract with its first cycle paid at t0 (as a migrated buyer would be). */
async function paidContract(o: { id: string }, email?: string) {
  const { contract, charge } = await billing.subscribe({
    offerId: o.id,
    customerName: 'Ana',
    customerEmail: email ?? `r-${crypto.randomUUID()}@test.dev`,
    customerDocument: '12345678909',
    now: t0,
  });
  await billing.settle(charge.id, 'PAID', t0);
  return db!.billingContract.findUniqueOrThrow({ where: { id: contract.id } });
}

const body = (contractId: string) => ({
  contractId,
  sig: signRenewal(contractId),
  paymentMethod: 'pix' as const,
});

/** Webhook path: FINAL_NET settlement of the Transaction + charge/contract advance. */
async function pay(transactionId: string, paidAt: Date) {
  return db!.$transaction(async (p) => {
    const row = await p.transaction.findUniqueOrThrow({
      where: { id: transactionId },
    });
    await settleFinalNet(p, row, 'COMPLETED', 'TEST');
    return markChargeSettled(p, row.id, 'COMPLETED', paidAt);
  });
}

const contractOf = (id: string) =>
  db!.billingContract.findUniqueOrThrow({ where: { id } });

/** Suspends a MANUAL_PAY contract: CHARGE_DUE at day 31, unpaid past grace at day 40. */
async function suspend(contractId: string) {
  await billing.runDue(at(31));
  await billing.runDue(at(40));
  expect((await contractOf(contractId)).status).toBe('SUSPENDED');
}

beforeAll(async () => {
  if (!db) return;
  process.env.DOM_TOKEN = 'test-token';
  process.env.RENEWAL_LINK_SECRET = 'r'.repeat(64);
  await useEmptyCaches();
  await seedGlobalPolicy(db);
  ownerId = (
    await db.user.create({
      data: {
        name: 'Seller',
        email: `seller-${crypto.randomUUID()}@test.dev`,
        password: 'x',
        role: 'USER',
        clientStatus: 'APPROVED',
      },
    })
  ).id;
  billing = new BillingCycleService(db as never);
  renewals = new OfferRenewalService(
    db as never,
    resolver,
    new ExternalRefService(db as never),
  );
});
afterAll(async () => {
  await db?.$disconnect();
});

run(
  'renews the pending cycle at its frozen amount; a second call returns the same PIX; duplicate webhook is a no-op',
  async () => {
    const o = await offer();
    const c = await paidContract(o);
    await billing.runDue(at(31));
    const cycle = await db!.charge.findFirstOrThrow({
      where: { contractId: c.id, status: 'PENDING' },
    });
    pixCalls = 0;
    const first = await renewals.renew(o.code, body(c.id), at(32));
    expect(first).toMatchObject({
      kind: 'CYCLE',
      existing: false,
      chargeId: cycle.id,
      chargeStatus: 'PENDING',
      attempts: 2,
      amount: cycle.amountCents / 100,
    });
    expect(first.pix.pixContent).toStartWith('000201');
    const again = await renewals.renew(o.code, body(c.id), at(32));
    expect(again).toMatchObject({ existing: true, attempts: 2 });
    expect(again.pix.pixContent).toBe(first.pix.pixContent);
    expect(pixCalls).toBe(1);
    // No second CHARGE_DUE reminder because attempts grew.
    await billing.runDue(at(33));
    expect(
      await db!.billingContractEvent.count({
        where: { contractId: c.id, type: 'CHARGE_DUE' },
      }),
    ).toBe(1);

    const paidAt = at(34);
    expect(await pay(first.transactionId, paidAt)).toBe(true);
    const after = await contractOf(c.id);
    expect(after.status).toBe('ACTIVE');
    // A normal cycle continues from the previous period end, not from the payment date.
    expect(after.currentPeriodStart).toEqual(c.currentPeriodEnd);
    expect(after.currentPeriodEnd).toEqual(
      new Date('2026-03-01T00:00:00.000Z'),
    );
    expect(after.nextChargeAt).toEqual(after.currentPeriodEnd);
    const paid = await db!.charge.findUniqueOrThrow({
      where: { id: cycle.id },
    });
    expect(paid.status).toBe('PAID');
    // Duplicate webhook: nothing changes and the seller is credited once.
    expect(await pay(first.transactionId, at(35))).toBe(false);
    expect((await contractOf(c.id)).version).toBe(after.version);
    const row = await db!.transaction.findUniqueOrThrow({
      where: { id: first.transactionId },
    });
    expect(row.status).toBe('COMPLETED');
    expect(Number(row.amount)).toBe(cycle.amountCents / 100);
  },
);

run(
  'an expired PIX is replaced by a new attempt on the same charge',
  async () => {
    const o = await offer();
    const c = await paidContract(o);
    await billing.runDue(at(31));
    pixExpire = '2026-02-02T00:00:00Z';
    const first = await renewals.renew(o.code, body(c.id), at(32));
    pixExpire = '2099-01-01T00:00:00Z';
    const second = await renewals.renew(o.code, body(c.id), at(40));
    expect(second.existing).toBe(false);
    expect(second.chargeId).toBe(first.chargeId);
    expect(second.attempts).toBe(3);
    expect(second.transactionId).not.toBe(first.transactionId);
    const old = await db!.transaction.findUniqueOrThrow({
      where: { id: first.transactionId },
    });
    expect(old.status).toBe('EXPIRED');
  },
);

run(
  'reactivates a suspended contract; the period starts at paidAt and the next cycle renews normally',
  async () => {
    const o = await offer();
    const c = await paidContract(o);
    await suspend(c.id);
    const first = await renewals.renew(o.code, body(c.id), at(50));
    expect(first).toMatchObject({ kind: 'REACTIVATION', attempts: 1 });
    const charge = await db!.charge.findUniqueOrThrow({
      where: { id: first.chargeId },
    });
    expect(charge.cycleKey).toStartWith('reactivation:');
    expect((charge.snapshot as any).reactivation).toBe(true);
    expect(charge.amountCents).toBe(Math.round(first.amount * 100));
    // Still suspended until it is paid.
    expect((await contractOf(c.id)).status).toBe('SUSPENDED');

    const paidAt = at(51);
    expect(await pay(first.transactionId, paidAt)).toBe(true);
    const react = await contractOf(c.id);
    expect(react).toMatchObject({
      status: 'ACTIVE',
      retryCount: 0,
      pastDueAt: null,
      suspendedAt: null,
      graceEndsAt: null,
      accessEndsAt: null,
    });
    expect(react.currentPeriodStart).toEqual(paidAt);
    expect(react.currentPeriodEnd).toEqual(
      new Date('2026-03-21T00:00:00.000Z'),
    );
    expect(react.nextChargeAt).toEqual(react.currentPeriodEnd);
    expect(await pay(first.transactionId, at(52))).toBe(false);

    // Next cycle: normal CHARGE_DUE, normal renewal, period continues from the old end.
    const due = new Date(react.nextChargeAt!.getTime() + 1000);
    const res = await billing.runDue(due);
    expect(res.awaitingBuyer).toBeGreaterThanOrEqual(1);
    const next = await renewals.renew(o.code, body(c.id), due);
    expect(next.kind).toBe('CYCLE');
    expect(next.chargeId).not.toBe(first.chargeId);
    await pay(next.transactionId, due);
    const renewed = await contractOf(c.id);
    expect(renewed.status).toBe('ACTIVE');
    expect(renewed.currentPeriodStart).toEqual(react.currentPeriodEnd);
    expect(renewed.currentPeriodEnd).toEqual(
      new Date('2026-04-21T00:00:00.000Z'),
    );
  },
);

run('a reactivation counts as a paid cycle for repetitions', async () => {
  const o = await offer({ repetitions: 2 });
  const c = await paidContract(o);
  await suspend(c.id);
  const out = await renewals.renew(o.code, body(c.id), at(50));
  expect(out.kind).toBe('REACTIVATION');
  await pay(out.transactionId, at(51));
  const done = await contractOf(c.id);
  expect(done.status).toBe('INACTIVE');
  expect(done.nextChargeAt).toBeNull();
  // Finished by repetitions: cannot be reactivated again.
  await expect(renewals.renew(o.code, body(c.id), at(60))).rejects.toThrow(
    'concluída',
  );
});

run(
  'a failed or expired reactivation leaves the contract suspended',
  async () => {
    const o = await offer();
    const c = await paidContract(o);
    await suspend(c.id);
    const out = await renewals.renew(o.code, body(c.id), at(50));
    await db!.$transaction(async (p) => {
      const row = await p.transaction.findUniqueOrThrow({
        where: { id: out.transactionId },
      });
      await settleFinalNet(p, row, 'EXPIRED', 'TEST');
      await markChargeSettled(p, row.id, 'EXPIRED', at(55));
    });
    const still = await contractOf(c.id);
    expect(still.status).toBe('SUSPENDED');
    expect(still.nextChargeAt).toBeNull();
    // The same reactivation charge is reopened with a new PIX.
    const retry = await renewals.renew(o.code, body(c.id), at(56));
    expect(retry.chargeId).toBe(out.chargeId);
    expect(retry.attempts).toBe(2);
    expect(retry.existing).toBe(false);
  },
);

run('concurrent calls create one reactivation charge and one PIX', async () => {
  const o = await offer();
  const c = await paidContract(o);
  await suspend(c.id);
  pixCalls = 0;
  const results = await Promise.all(
    [0, 1, 2].map(() => renewals.renew(o.code, body(c.id), at(50))),
  );
  expect(new Set(results.map((r) => r.chargeId)).size).toBe(1);
  expect(new Set(results.map((r) => r.pix.pixContent)).size).toBe(1);
  expect(pixCalls).toBe(1);
  expect(
    await db!.charge.count({
      where: { contractId: c.id, cycleKey: { startsWith: 'reactivation:' } },
    }),
  ).toBe(1);
});

run('bad signature, missing secret and wrong offer', async () => {
  const o = await offer();
  const other = await offer();
  const c = await paidContract(o);
  await billing.runDue(at(31));
  const forged = { ...body(c.id), sig: 'a'.repeat(64) };
  const ghost = { ...body(crypto.randomUUID()), sig: 'a'.repeat(64) };
  const messages: string[] = [];
  for (const input of [forged, ghost, { ...forged, sig: 'nope' }]) {
    try {
      await renewals.renew(o.code, input, at(32));
      throw new Error('should have been rejected');
    } catch (error: any) {
      expect(error.getStatus()).toBe(403);
      messages.push(JSON.stringify(error.getResponse()));
    }
  }
  // Same body whether the contract exists or not.
  expect(new Set(messages).size).toBe(1);

  // Valid signature, but the contract belongs to another offer.
  await expect(renewals.renew(other.code, body(c.id), at(32))).rejects.toThrow(
    'Assinatura não encontrada',
  );

  const secret = process.env.RENEWAL_LINK_SECRET;
  const good = body(c.id);
  delete process.env.RENEWAL_LINK_SECRET;
  try {
    await expect(renewals.renew(o.code, good, at(32))).rejects.toThrow(
      'Link de renovação inválido',
    );
  } finally {
    process.env.RENEWAL_LINK_SECRET = secret;
  }
  expect(pixCalls).toBeGreaterThanOrEqual(0);
});

run('cancelled, never-paid and up-to-date contracts answer 409', async () => {
  const o = await offer();
  const cancelled = await paidContract(o);
  await db!.billingContract.update({
    where: { id: cancelled.id },
    data: { status: 'CANCELLED', nextChargeAt: null },
  });
  await expect(
    renewals.renew(o.code, body(cancelled.id), at(5)),
  ).rejects.toThrow('cancelada');

  const fresh = await billing.subscribe({
    offerId: o.id,
    customerName: 'Ana',
    customerEmail: `n-${crypto.randomUUID()}@test.dev`,
    customerDocument: '12345678909',
    now: t0,
  });
  await expect(
    renewals.renew(o.code, body(fresh.contract.id), at(5)),
  ).rejects.toThrow('nunca foi paga');

  const upToDate = await paidContract(o);
  await expect(
    renewals.renew(o.code, body(upToDate.id), at(5)),
  ).rejects.toThrow('em dia');
});
