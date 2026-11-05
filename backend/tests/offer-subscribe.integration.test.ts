import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { useEmptyCaches } from '../src/application/use-cases/payment-link/charge-characterization.fixture';
import { Acquirer } from '../src/core/services/acquirer.enum';
import { acquirerCapabilities } from '../src/core/services/acquirer-capabilities';
import { PrismaUserRepository } from '../src/infrastructure/database/repositories/prisma-user.repository';
import { BillingCycleService } from '../src/modules/billing-core/billing-cycle.service';
import {
  CardTokenEndpointSource,
  SubscriptionCardTokenSource,
} from '../src/modules/billing-core/card-token-sources';
import { markChargeSettled } from '../src/modules/billing-core/charge-settlement';
import { ExternalRefService } from '../src/modules/billing-core/external-ref.service';
import { StoredCardVaultService } from '../src/modules/billing-core/stored-card-vault.service';
import { OfferSubscribeService } from '../src/modules/offer/offer-subscribe.service';
import { settleFinalNet } from '../src/modules/platform-core/link-settlement';
import { seedGlobalPolicy } from './billing-policy-fixture';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db
  ? (name: string, fn: () => Promise<void>) => test(name, fn, 30_000)
  : test.skip;

const PAN = '4111111111111111';
const CVV = '987';
const buyer = (email: string) => ({
  customerName: 'Ana',
  customerEmail: email,
  customerDocument: '123.456.789-09',
});
const card = {
  number: PAN,
  cvv: CVV,
  exp_month: '12',
  exp_year: '2099',
  holder_name: 'Ana',
  holder_document: '12345678909',
  brand: 'visa',
};

let ownerId: string;
let calls: Record<string, number>;
let subStatus = 'active';
let acquirerCaps = acquirerCapabilities(Acquirer.DOM);
const gateway: any = {
  createPlan: async () => {
    calls.plan++;
    return { id: `plan-${crypto.randomUUID()}` };
  },
  createSubscriptionFromCheckout: async () => {
    calls.sub++;
    return { id: `sub-${crypto.randomUUID()}`, status: subStatus };
  },
  getSubscription: async () => ({ card: { token: 'reusable-sub-token' } }),
  createReusableCardToken: async () => 'reusable-endpoint-token',
  createPaymentLink: async () => ({ id: `link-${crypto.randomUUID()}` }),
  chargePaymentLink: async () => {
    calls.link++;
    return { id: `dom-pay-${crypto.randomUUID()}`, status: subStatus };
  },
  chargePixForLink: async (_t: string, input: any) => {
    calls.pix++;
    return {
      id: `dom-pix-${crypto.randomUUID()}`,
      status: 'pending',
      pixContent: '000201pix',
      qrCode: 'qr',
      pixExpire: '2099-01-01T00:00:00Z',
      amount: input.amount,
    };
  },
};
const resolver: any = {
  acquirerForSlug: () => Acquirer.DOM,
  capabilitiesFor: () => acquirerCaps,
  byAcquirer: () => gateway,
};

let vault: StoredCardVaultService;
let billing: BillingCycleService;
function service(kind: 'subscription' | 'card-token' = 'subscription') {
  const refs = new ExternalRefService(db as never);
  return new OfferSubscribeService(
    db as never,
    new PrismaUserRepository(db as never),
    resolver,
    refs,
    billing,
    vault,
    kind === 'card-token'
      ? new CardTokenEndpointSource()
      : new SubscriptionCardTokenSource(refs),
  );
}

async function offer(over: Record<string, unknown> = {}) {
  return db!.offer.create({
    data: {
      ownerUserId: ownerId,
      createdByUserId: ownerId,
      code: `S${crypto.randomUUID().slice(0, 9).toUpperCase()}`,
      kind: 'PLAN',
      name: 'Plano',
      amountCents: 10000,
      acceptedMethods: ['CREDIT_CARD', 'PIX'],
      renewalMode: 'AUTO_CHARGE',
      intervalType: 'MONTH',
      intervalCount: 1,
      ...over,
    } as never,
  });
}

beforeAll(async () => {
  if (!db) return;
  process.env.DOM_TOKEN = 'test-token';
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  await useEmptyCaches();
  await seedGlobalPolicy(db);
  const owner = await db.user.create({
    data: {
      name: 'Seller',
      email: `seller-${crypto.randomUUID()}@test.dev`,
      password: 'x',
      role: 'USER',
      clientStatus: 'APPROVED',
    },
  });
  ownerId = owner.id;
  await db.acquirerCatalogue.upsert({
    where: { code: 'DOM' },
    update: {},
    create: { code: 'DOM', name: 'DOM' },
  });
  vault = new StoredCardVaultService(db as never);
  billing = new BillingCycleService(db as never);
});
afterAll(async () => {
  await db?.$disconnect();
});
function reset() {
  calls = { plan: 0, sub: 0, link: 0, pix: 0 };
  subStatus = 'active';
  acquirerCaps = acquirerCapabilities(Acquirer.DOM);
}

run(
  'AUTO_CHARGE via subscription source: pays, activates, stores token, never keeps PAN/CVV, idempotent',
  async () => {
    reset();
    const o = await offer();
    const email = `a-${crypto.randomUUID()}@test.dev`;
    const out = await service().subscribe(o.code, {
      paymentMethod: 'credit_card',
      ...buyer(email),
      card,
    });
    expect(out).toMatchObject({
      existing: false,
      contractStatus: 'ACTIVE',
      chargeStatus: 'PAID',
      cardSaved: true,
    });
    const charge = await db!.charge.findUniqueOrThrow({
      where: { id: out.chargeId },
    });
    expect(charge.contractId).toBe(out.contractId);
    expect(charge.cycleKey).toBeTruthy();
    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: out.transactionId! },
    });
    expect(tx.status).toBe('COMPLETED');
    expect(tx.settlementBasis).toBe('FINAL_NET');
    expect(
      await db!.transaction.count({
        where: {
          description: { contains: o.name },
          userId: ownerId,
          customerEmail: email,
        },
      }),
    ).toBe(1);
    const contract = await db!.billingContract.findUniqueOrThrow({
      where: { id: out.contractId },
    });
    expect(contract.nextChargeAt).not.toBeNull();
    expect(contract.metadata).toBeNull();

    const stored = await vault.resolveForContract(out.contractId, 'DOM');
    expect(stored?.token).toBe('reusable-sub-token');
    const cardRow = await db!.storedCard.findFirstOrThrow({
      where: { contractId: out.contractId },
    });
    expect(cardRow).toMatchObject({
      last4: '1111',
      brand: 'visa',
      expMonth: 12,
      expYear: 2099,
    });

    // No PAN/CVV anywhere in what we persisted for this buyer.
    const dump = JSON.stringify([
      cardRow,
      contract,
      charge,
      tx,
      await db!.storedCardToken.findMany({
        where: { storedCardId: cardRow.id },
      }),
    ]);
    expect(dump).not.toContain(PAN);
    expect(dump).not.toContain(CVV);

    // Same (offer, email) while active: existing contract, no new charge or gateway call.
    const again = await service().subscribe(o.code, {
      paymentMethod: 'credit_card',
      ...buyer(email.toUpperCase()),
      card,
    });
    expect(again).toMatchObject({ existing: true, contractId: out.contractId });
    expect(calls.sub).toBe(1);
    expect(
      (await db!.offer.findUniqueOrThrow({ where: { id: o.id } })).usedCount,
    ).toBe(1);
    expect(await db!.billingContract.count({ where: { offerId: o.id } })).toBe(
      1,
    );
  },
);

run('AUTO_CHARGE via card-token source stores the endpoint token', async () => {
  reset();
  const o = await offer();
  const out = await service('card-token').subscribe(o.code, {
    paymentMethod: 'credit_card',
    ...buyer(`b-${crypto.randomUUID()}@test.dev`),
    card,
  });
  expect(out).toMatchObject({ chargeStatus: 'PAID', cardSaved: true });
  expect(calls.link).toBe(1);
  expect((await vault.resolveForContract(out.contractId, 'DOM'))?.token).toBe(
    'reusable-endpoint-token',
  );
});

run(
  'refused first charge cancels the contract, releases the use and frees a retry',
  async () => {
    reset();
    subStatus = 'refused';
    const o = await offer({ maxUses: 1 });
    const email = `c-${crypto.randomUUID()}@test.dev`;
    await expect(
      service().subscribe(o.code, {
        paymentMethod: 'credit_card',
        ...buyer(email),
        card,
      }),
    ).rejects.toThrow('Pagamento recusado');
    expect(
      (await db!.offer.findUniqueOrThrow({ where: { id: o.id } })).usedCount,
    ).toBe(0);
    const dead = await db!.billingContract.findFirstOrThrow({
      where: { offerId: o.id },
    });
    expect(dead.status).toBe('CANCELLED');
    expect(await db!.storedCard.count({ where: { contractId: dead.id } })).toBe(
      0,
    );

    subStatus = 'active';
    const retry = await service().subscribe(o.code, {
      paymentMethod: 'credit_card',
      ...buyer(email),
      card,
    });
    expect(retry).toMatchObject({ existing: false, contractStatus: 'ACTIVE' });
    expect(retry.contractId).not.toBe(dead.id);
  },
);

run(
  'pending first charge: no card yet; webhook settlement activates, completeCardCapture stores the token',
  async () => {
    reset();
    subStatus = 'pending';
    const o = await offer();
    const email = `d-${crypto.randomUUID()}@test.dev`;
    const svc = service();
    const out = await svc.subscribe(o.code, {
      paymentMethod: 'credit_card',
      ...buyer(email),
      card,
    });
    expect(out).toMatchObject({
      contractStatus: 'INACTIVE',
      chargeStatus: 'PENDING',
      cardSaved: false,
    });
    const pending = await db!.billingContract.findUniqueOrThrow({
      where: { id: out.contractId },
    });
    expect(pending.metadata).toMatchObject({ pendingCard: { last4: '1111' } });
    expect(JSON.stringify(pending.metadata)).not.toContain(PAN);
    expect(await svc.completeCardCapture(out.contractId)).toBe(false);

    // Webhook path: Transaction completes -> Charge paid -> contract advances.
    await db!.$transaction(async (p) => {
      const row = await p.transaction.findUniqueOrThrow({
        where: { id: out.transactionId! },
      });
      await settleFinalNet(p, row, 'COMPLETED', 'TEST');
      await markChargeSettled(p, row.id, 'COMPLETED');
    });
    expect(
      (
        await db!.billingContract.findUniqueOrThrow({
          where: { id: out.contractId },
        })
      ).status,
    ).toBe('ACTIVE');
    expect(await svc.completeCardCapture(out.contractId)).toBe(true);
    expect((await vault.resolveForContract(out.contractId, 'DOM'))?.token).toBe(
      'reusable-sub-token',
    );
    expect(await svc.completeCardCapture(out.contractId)).toBe(false);
  },
);

run(
  'MANUAL_PAY: first cycle PIX, activation on payment, later cycle emits CHARGE_DUE',
  async () => {
    reset();
    const o = await offer({
      renewalMode: 'MANUAL_PAY',
      acceptedMethods: ['PIX'],
    });
    const email = `e-${crypto.randomUUID()}@test.dev`;
    const out = await service().subscribe(o.code, {
      paymentMethod: 'pix',
      ...buyer(email),
    });
    expect(out).toMatchObject({
      contractStatus: 'INACTIVE',
      chargeStatus: 'PENDING',
      cardSaved: false,
    });
    expect(out.pix?.pixContent).toBe('000201pix');
    expect(calls.pix).toBe(1);

    // Repeating while pending returns the same contract with the PIX again.
    const again = await service().subscribe(o.code, {
      paymentMethod: 'pix',
      ...buyer(email),
    });
    expect(again).toMatchObject({ existing: true, contractId: out.contractId });
    expect(again.pix?.pixContent).toBe('000201pix');
    expect(calls.pix).toBe(1);

    const paidAt = new Date('2026-01-01T00:00:00Z');
    await db!.$transaction(async (p) => {
      const row = await p.transaction.findUniqueOrThrow({
        where: { id: out.transactionId! },
      });
      await settleFinalNet(p, row, 'COMPLETED', 'TEST');
      await markChargeSettled(p, row.id, 'COMPLETED', paidAt);
    });
    const active = await db!.billingContract.findUniqueOrThrow({
      where: { id: out.contractId },
    });
    expect(active.status).toBe('ACTIVE');
    const run1 = await billing.runDue(
      new Date(active.nextChargeAt!.getTime() + 1000),
    );
    expect(run1.awaitingBuyer).toBeGreaterThanOrEqual(1);
    expect(
      await db!.billingContractEvent.count({
        where: { contractId: out.contractId, type: 'CHARGE_DUE' },
      }),
    ).toBe(1);
  },
);

run(
  'validations: wrong method, acquirer without stored-card charge, one-off offer, missing card',
  async () => {
    reset();
    const auto = await offer();
    const email = `f-${crypto.randomUUID()}@test.dev`;
    await expect(
      service().subscribe(auto.code, { paymentMethod: 'pix', ...buyer(email) }),
    ).rejects.toThrow('cartão de crédito');
    await expect(
      service().subscribe(auto.code, {
        paymentMethod: 'credit_card',
        ...buyer(email),
      }),
    ).rejects.toThrow('cartão');
    acquirerCaps = { ...acquirerCaps, chargeStoredCard: false };
    await expect(
      service().subscribe(auto.code, {
        paymentMethod: 'credit_card',
        ...buyer(email),
        card,
      }),
    ).rejects.toThrow('cobrança automática');
    acquirerCaps = acquirerCapabilities(Acquirer.DOM);
    const oneOff = await offer({ renewalMode: 'NONE' });
    await expect(
      service().subscribe(oneOff.code, {
        paymentMethod: 'credit_card',
        ...buyer(email),
        card,
      }),
    ).rejects.toThrow('não é recorrente');
    const noCard = await offer({ acceptedMethods: ['PIX'] });
    await expect(
      service().subscribe(noCard.code, {
        paymentMethod: 'credit_card',
        ...buyer(email),
        card,
      }),
    ).rejects.toThrow('não aceita');
    expect(
      (await db!.offer.findUniqueOrThrow({ where: { id: auto.id } })).usedCount,
    ).toBe(0);
  },
);

run(
  'concurrent subscribe for the same buyer creates one contract and one charge',
  async () => {
    reset();
    const o = await offer();
    const email = `g-${crypto.randomUUID()}@test.dev`;
    const results = await Promise.allSettled([
      service().subscribe(o.code, {
        paymentMethod: 'credit_card',
        ...buyer(email),
        card,
      }),
      service().subscribe(o.code, {
        paymentMethod: 'credit_card',
        ...buyer(email),
        card,
      }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await db!.billingContract.count({ where: { offerId: o.id } })).toBe(
      1,
    );
    expect(
      await db!.charge.count({ where: { offerId: o.id, status: 'PAID' } }),
    ).toBe(1);
    expect(
      (await db!.offer.findUniqueOrThrow({ where: { id: o.id } })).usedCount,
    ).toBe(1);
  },
);
