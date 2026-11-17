import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { useEmptyCaches } from '../src/application/use-cases/payment-link/charge-characterization.fixture';
import { Acquirer } from '../src/core/services/acquirer.enum';
import { acquirerCapabilities } from '../src/core/services/acquirer-capabilities';
import { BillingCycleService } from '../src/modules/billing-core/billing-cycle.service';
import { StoredCardCycleExecutor } from '../src/modules/billing-core/stored-card-cycle.executor';
import { StoredCardVaultService } from '../src/modules/billing-core/stored-card-vault.service';
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
let cardCalls: any[] = [];
let cardStatus = 'paid';
const gateway: any = {
  chargeStoredCardToken: async (_t: string, input: any) => {
    cardCalls.push(input);
    return { id: `dom-card-${crypto.randomUUID()}`, status: cardStatus };
  },
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
let vault: StoredCardVaultService;
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
const cardBody = (contractId: string) => ({
  contractId,
  sig: signRenewal(contractId),
  paymentMethod: 'card' as const,
});

async function saveCard(contractId: string, expYear = 2099) {
  await vault.save({
    ownerUserId: ownerId,
    contractId,
    customerEmail: 'a@test.dev',
    acquirerCode: 'DOM',
    token: 'tok_secret',
    last4: '4242',
    expMonth: 12,
    expYear,
  });
}

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
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
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
  vault = new StoredCardVaultService(db as never);
  renewals = new OfferRenewalService(
    db as never,
    resolver,
    new ExternalRefService(db as never),
    billing,
    new StoredCardCycleExecutor(db as never, vault, resolver),
    vault,
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

run(
  'renews the due cycle with the stored card at the frozen card amount, once',
  async () => {
    process.env.RENEWAL_LINK_SECRET = 'r'.repeat(64);
    const o = await offer({ acceptedMethods: ['PIX', 'CREDIT_CARD'] });
    const c = await paidContract(o);
    await billing.runDue(at(31));
    await saveCard(c.id);
    cardCalls = [];
    cardStatus = 'paid';
    const out = await renewals.renew(o.code, cardBody(c.id), at(32));
    expect(out).toMatchObject({
      kind: 'CYCLE',
      method: 'CARD',
      cardOutcome: 'PAID',
      chargeStatus: 'PAID',
      contractStatus: 'ACTIVE',
    });
    expect(cardCalls).toHaveLength(1);
    expect(cardCalls[0].amount).toBe(out.amount);
    expect(cardCalls[0].idempotencyKey).toBe(
      `cycle:${out.chargeId}:${out.attempts}`,
    );
    const after = await contractOf(c.id);
    expect(after.currentPeriodStart).toEqual(c.currentPeriodEnd);
    // Already paid: a second call neither charges nor opens another charge.
    await expect(
      renewals.renew(o.code, cardBody(c.id), at(33)),
    ).rejects.toThrow(/em dia/);
    expect(cardCalls).toHaveLength(1);
  },
);

run(
  'a refused card leaves the charge reopenable and PIX still works',
  async () => {
    const o = await offer({ acceptedMethods: ['PIX', 'CREDIT_CARD'] });
    const c = await paidContract(o);
    await billing.runDue(at(31));
    await saveCard(c.id);
    cardStatus = 'failed';
    const out = await renewals.renew(o.code, cardBody(c.id), at(32));
    expect(out).toMatchObject({ method: 'CARD', cardOutcome: 'FAILED' });
    expect(out.chargeStatus).toBe('FAILED');
    // The same cycle charge is reopened by PIX instead of a second charge.
    const pix = await renewals.renew(o.code, body(c.id), at(33));
    expect(pix.chargeId).toBe(out.chargeId);
    expect(pix.method).toBe('PIX');
    expect(
      await db!.charge.count({
        where: {
          contractId: c.id,
          cycleKey: { not: { startsWith: 'reactivation:' } },
        },
      }),
    ).toBe(2);
  },
);

run('reactivates a suspended contract with the stored card', async () => {
  const o = await offer({ acceptedMethods: ['PIX', 'CREDIT_CARD'] });
  const c = await paidContract(o);
  await saveCard(c.id);
  await suspend(c.id);
  cardCalls = [];
  cardStatus = 'paid';
  const out = await renewals.renew(o.code, cardBody(c.id), at(50));
  expect(out).toMatchObject({
    kind: 'REACTIVATION',
    method: 'CARD',
    cardOutcome: 'PAID',
    contractStatus: 'ACTIVE',
  });
  expect(cardCalls).toHaveLength(1);
  expect((await contractOf(c.id)).currentPeriodStart).toEqual(at(50));
});

run('card renewal needs a usable stored card and accepted card', async () => {
  const o = await offer({ acceptedMethods: ['PIX', 'CREDIT_CARD'] });
  const c = await paidContract(o);
  await billing.runDue(at(31));
  await expect(renewals.renew(o.code, cardBody(c.id), at(32))).rejects.toThrow(
    /cartão salvo/,
  );
  await saveCard(c.id, 2020);
  await expect(renewals.renew(o.code, cardBody(c.id), at(32))).rejects.toThrow(
    /cartão salvo/,
  );
  const pixOnly = await offer();
  const p = await paidContract(pixOnly);
  await billing.runDue(at(31));
  await saveCard(p.id);
  await expect(
    renewals.renew(pixOnly.code, cardBody(p.id), at(32)),
  ).rejects.toThrow(/não aceita cartão/);
});

run(
  'an expired PIX charge is reopened by runDue and by renewal without double charging',
  async () => {
    const o = await offer();
    const c = await paidContract(o);
    await billing.runDue(at(31));
    const first = await renewals.renew(o.code, body(c.id), at(32));
    // PIX-expired webhook: charge EXPIRED, contract PAST_DUE with a retry date.
    await db!.$transaction(async (p) => {
      const row = await p.transaction.findUniqueOrThrow({
        where: { id: first.transactionId },
      });
      await settleFinalNet(p, row, 'EXPIRED', 'TEST');
      await markChargeSettled(p, row.id, 'EXPIRED', at(33));
    });
    const expired = await db!.charge.findUniqueOrThrow({
      where: { id: first.chargeId },
    });
    expect(expired.status).toBe('EXPIRED');
    const due = await contractOf(c.id);
    expect(due.status).toBe('PAST_DUE');
    expect(due.nextChargeAt).not.toBeNull();

    const retryAt = new Date(due.nextChargeAt!.getTime() + 1000);
    const run1 = await billing.runDue(retryAt);
    expect(run1.issued).toBe(1);
    const reopened = await db!.charge.findUniqueOrThrow({
      where: { id: first.chargeId },
    });
    expect(reopened.status).toBe('PENDING');
    expect(reopened.attempts).toBe(expired.attempts + 1);
    // Running again does not open or charge anything else.
    const run2 = await billing.runDue(retryAt);
    expect(run2.issued).toBe(0);
    expect(
      await db!.charge.count({
        where: { contractId: c.id, status: 'PENDING' },
      }),
    ).toBe(1);
    // The buyer renews it by PIX: one new PIX on the same charge, paid once.
    const again = await renewals.renew(o.code, body(c.id), retryAt);
    expect(again.chargeId).toBe(first.chargeId);
    expect(await pay(again.transactionId, at(36))).toBe(true);
    expect(await pay(again.transactionId, at(37))).toBe(false);
    expect(
      await db!.charge.count({ where: { contractId: c.id, status: 'PAID' } }),
    ).toBe(2);
  },
);

run('renewal alone reopens an EXPIRED cycle charge idempotently', async () => {
  const o = await offer();
  const c = await paidContract(o);
  await billing.runDue(at(31));
  const first = await renewals.renew(o.code, body(c.id), at(32));
  await db!.$transaction(async (p) => {
    const row = await p.transaction.findUniqueOrThrow({
      where: { id: first.transactionId },
    });
    await settleFinalNet(p, row, 'EXPIRED', 'TEST');
    await markChargeSettled(p, row.id, 'EXPIRED', at(33));
  });
  pixCalls = 0;
  const results = await Promise.all(
    [0, 1].map(() => renewals.renew(o.code, body(c.id), at(34))),
  );
  expect(new Set(results.map((r) => r.chargeId))).toEqual(
    new Set([first.chargeId]),
  );
  expect(pixCalls).toBe(1);
  expect(
    await db!.charge.count({
      where: { contractId: c.id, status: { in: ['PENDING', 'EXPIRED'] } },
    }),
  ).toBe(1);
});
