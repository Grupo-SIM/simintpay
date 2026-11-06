import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { BillingCycleService } from '../src/modules/billing-core/billing-cycle.service';
import { seedGlobalPolicy } from './billing-policy-fixture';
import { giveStoredCard } from './stored-card-fixture';
import { ChargeDueDeliveryService } from '../src/modules/billing-core/charge-due-delivery.service';

const url = process.env.BILLING_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db
  ? (name: string, fn: () => Promise<void>) => test(name, fn, 30_000)
  : test.skip;
const day = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-01-01T00:00:00.000Z');
const at = (days: number) => new Date(t0.getTime() + days * day);
let service: BillingCycleService;
let ownerId: string;

async function offer(renewalMode: 'AUTO_CHARGE' | 'MANUAL_PAY', extra = {}) {
  return db!.offer.create({
    data: {
      ownerUserId: ownerId,
      createdByUserId: ownerId,
      code: `OFF-${crypto.randomUUID()}`,
      kind: 'PLAN',
      name: 'Plano',
      amountCents: 4990,
      acceptedMethods: ['CREDIT_CARD', 'PIX'],
      renewalMode,
      intervalType: 'MONTH',
      intervalCount: 1,
      retryDays: 3,
      graceDays: 7,
      ...extra,
    },
  });
}

async function activate(offerId: string, email: string, card = true) {
  const { contract, charge } = await service.subscribe({
    offerId,
    customerName: 'Buyer',
    customerEmail: email,
    now: t0,
  });
  await service.settle(charge.id, 'PAID', t0);
  const active = await db!.billingContract.findUniqueOrThrow({
    where: { id: contract.id },
  });
  // AUTO_CHARGE is only effective with a usable stored card.
  if (card) await giveStoredCard(db!, active);
  return active;
}

beforeAll(async () => {
  if (!db) return;
  service = new BillingCycleService(db as never);
  await seedGlobalPolicy(db);
  const owner = await db.user.create({
    data: {
      name: 'Seller',
      email: `seller-${crypto.randomUUID()}@test.dev`,
      password: 'x',
    },
  });
  ownerId = owner.id;
});
afterAll(async () => {
  await db?.$disconnect();
});

run(
  'first payment activates the contract and schedules the next cycle',
  async () => {
    const o = await offer('AUTO_CHARGE');
    const c = await activate(o.id, 'a@test.dev');
    expect(c.status).toBe('ACTIVE');
    expect(c.currentPeriodEnd).toEqual(new Date('2026-02-01T00:00:00.000Z'));
    expect(c.nextChargeAt).toEqual(c.currentPeriodEnd);
  },
);

run('settling the same charge twice only applies once', async () => {
  const o = await offer('AUTO_CHARGE');
  const { charge } = await service.subscribe({
    offerId: o.id,
    customerName: 'B',
    customerEmail: 'dup@test.dev',
    now: t0,
  });
  expect((await service.settle(charge.id, 'PAID', t0)).applied).toBe(true);
  expect((await service.settle(charge.id, 'PAID', at(1))).applied).toBe(false);
  expect((await service.settle(charge.id, 'FAILED', at(1))).applied).toBe(
    false,
  );
});

run(
  'auto charge bills each due cycle exactly once, even if run twice',
  async () => {
    const o = await offer('AUTO_CHARGE');
    const c = await activate(o.id, 'auto@test.dev');
    let calls = 0;
    const executor = {
      charge: async () => {
        calls++;
        return { outcome: 'PAID' as const };
      },
    };
    const first = await service.runDue(at(31), executor);
    const second = await service.runDue(at(31), executor);
    expect(first.autoPaid).toBeGreaterThanOrEqual(1);
    expect(second.issued).toBe(0);
    const after = await db!.billingContract.findUniqueOrThrow({
      where: { id: c.id },
    });
    expect(after.currentPeriodEnd).toEqual(
      new Date('2026-03-01T00:00:00.000Z'),
    );
    expect(
      await db!.charge.count({ where: { contractId: c.id, status: 'PAID' } }),
    ).toBe(2);
    expect(calls).toBeGreaterThanOrEqual(1);
  },
);

run(
  'failed auto charge goes past due, retries, then suspends after grace',
  async () => {
    const o = await offer('AUTO_CHARGE');
    const c = await activate(o.id, 'fail@test.dev');
    const fail = { charge: async () => ({ outcome: 'FAILED' as const }) };
    await service.runDue(at(31), fail);
    expect(
      (await db!.billingContract.findUniqueOrThrow({ where: { id: c.id } }))
        .status,
    ).toBe('PAST_DUE');
    await service.runDue(at(34), fail);
    await service.runDue(at(37), fail);
    const end = await db!.billingContract.findUniqueOrThrow({
      where: { id: c.id },
    });
    expect(end.status).toBe('SUSPENDED');
    expect(end.nextChargeAt).toBeNull();
    // Um único registro de cobrança por ciclo, reaberto a cada tentativa.
    const charges = await db!.charge.findMany({
      where: { contractId: c.id, status: { not: 'PAID' } },
    });
    expect(charges.length).toBe(1);
    expect(charges[0]!.attempts).toBeGreaterThanOrEqual(3);
  },
);

run(
  'manual pay emits a due event once and suspends when unpaid past grace',
  async () => {
    const o = await offer('MANUAL_PAY');
    const c = await activate(o.id, 'manual@test.dev');
    const first = await service.runDue(at(31));
    expect(first.awaitingBuyer).toBeGreaterThanOrEqual(1);
    await service.runDue(at(32));
    const events = await db!.billingContractEvent.findMany({
      where: { contractId: c.id, type: 'CHARGE_DUE' },
    });
    expect(events.length).toBe(1);
    const late = await service.runDue(at(40));
    expect(late.expired).toBeGreaterThanOrEqual(1);
    expect(
      (await db!.billingContract.findUniqueOrThrow({ where: { id: c.id } }))
        .status,
    ).toBe('SUSPENDED');
  },
);

run(
  'AUTO_CHARGE without an executor is buyer-paid and delivers CHARGE_DUE once',
  async () => {
    const auto = await offer('AUTO_CHARGE');
    const ac = await activate(auto.id, 'nodelegate@test.dev');
    const manual = await offer('MANUAL_PAY');
    const mc = await activate(manual.id, 'deliver@test.dev');
    const res = await service.runDue(at(31));
    expect(res.buyerPaidFallback).toBeGreaterThanOrEqual(1);
    expect(
      await db!.charge.count({
        where: { contractId: ac.id, status: 'PENDING' },
      }),
    ).toBe(1);

    const notices: string[] = [];
    const delivery = new ChargeDueDeliveryService(db as never, {
      chargeDue: async (n) => {
        notices.push(n.contractId);
      },
    });
    await delivery.deliverPending();
    await delivery.deliverPending();
    expect(notices.filter((id) => id === mc.id).length).toBe(1);
    const ev = await db!.billingContractEvent.findFirstOrThrow({
      where: { contractId: mc.id, type: 'CHARGE_DUE' },
    });
    expect(ev.deliveredAt).not.toBeNull();
  },
);

run('stops after the configured number of cycles', async () => {
  const o = await offer('AUTO_CHARGE', { repetitions: 2 });
  const c = await activate(o.id, 'limit@test.dev');
  await service.runDue(at(31), {
    charge: async () => ({ outcome: 'PAID' as const }),
  });
  const end = await db!.billingContract.findUniqueOrThrow({
    where: { id: c.id },
  });
  expect(end.status).toBe('INACTIVE');
  expect(end.nextChargeAt).toBeNull();
});

run(
  'an UNKNOWN gateway outcome leaves the charge PENDING and the contract untouched',
  async () => {
    const o = await offer('AUTO_CHARGE');
    const c = await activate(o.id, 'unknown@test.dev');
    const unknown = {
      charge: async () => ({ outcome: 'UNKNOWN' as const }),
    };
    const result = await service.runDue(at(31), unknown);
    expect(result.unknown).toBeGreaterThanOrEqual(1);
    const after = await db!.billingContract.findUniqueOrThrow({
      where: { id: c.id },
    });
    expect(after.status).toBe('ACTIVE');
    expect(after.retryCount).toBe(0);
    expect(after.currentPeriodEnd).toEqual(c.currentPeriodEnd);
    const pending = await db!.charge.findMany({
      where: { contractId: c.id, status: 'PENDING' },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.attempts).toBe(1);
    // Rodar de novo não reemite nem recobra a cobrança PENDING.
    const again = await service.runDue(at(31), unknown);
    expect(again.issued).toBe(0);
  },
);

run(
  'AUTO_CHARGE contracts the executor cannot charge become buyer-paid, never charged',
  async () => {
    const o = await offer('AUTO_CHARGE');
    const c = await activate(o.id, 'unsupported@test.dev');
    let calls = 0;
    const executor = {
      canCharge: () => false,
      charge: async () => {
        calls++;
        return { outcome: 'PAID' as const };
      },
    };
    const res = await service.runDue(at(31), executor);
    expect(calls).toBe(0);
    expect(res.awaitingBuyer).toBeGreaterThanOrEqual(1);
    expect(
      await db!.charge.count({
        where: { contractId: c.id, status: 'PENDING' },
      }),
    ).toBe(1);
    expect(
      await db!.billingContractEvent.count({
        where: { contractId: c.id, type: 'CHARGE_DUE' },
      }),
    ).toBe(1);
  },
);

run(
  'AUTO_CHARGE offer, contract without a card: CHARGE_DUE once, PIX total, suspended only after grace',
  async () => {
    const o = await offer('AUTO_CHARGE');
    const c = await activate(o.id, 'nocard@test.dev', false);
    let calls = 0;
    const executor = {
      charge: async () => {
        calls++;
        return { outcome: 'FAILED' as const };
      },
    };
    const first = await service.runDue(at(31), executor);
    expect(first.awaitingBuyer).toBeGreaterThanOrEqual(1);
    expect(calls).toBe(0);
    const charge = await db!.charge.findFirstOrThrow({
      where: { contractId: c.id, status: 'PENDING' },
    });
    expect(charge.method).toBe('PIX');
    expect(charge.attempts).toBe(1);
    // Re-runs inside the grace window are idempotent: no new charge, no new event, no suspension.
    await service.runDue(at(31), executor);
    await service.runDue(at(36), executor);
    expect(
      await db!.billingContractEvent.count({
        where: { contractId: c.id, type: 'CHARGE_DUE' },
      }),
    ).toBe(1);
    expect(await db!.charge.count({ where: { contractId: c.id } })).toBe(2);
    expect(
      (await db!.billingContract.findUniqueOrThrow({ where: { id: c.id } }))
        .status,
    ).toBe('ACTIVE');
    const late = await service.runDue(at(40), executor);
    expect(late.expired).toBeGreaterThanOrEqual(1);
    expect(calls).toBe(0);
    expect(
      (await db!.billingContract.findUniqueOrThrow({ where: { id: c.id } }))
        .status,
    ).toBe('SUSPENDED');
  },
);

run(
  'AUTO_CHARGE offer, contract with a card: the card is charged',
  async () => {
    const o = await offer('AUTO_CHARGE');
    const c = await activate(o.id, 'withcard@test.dev');
    let calls = 0;
    const executor = {
      canCharge: () => true,
      charge: async () => {
        calls++;
        return { outcome: 'PAID' as const };
      },
    };
    const res = await service.runDue(at(31), executor);
    expect(res.autoPaid).toBeGreaterThanOrEqual(1);
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(
      await db!.billingContractEvent.count({
        where: { contractId: c.id, type: 'CHARGE_DUE' },
      }),
    ).toBe(0);
  },
);

run(
  'a declined card on a contract with a card keeps retry and past due',
  async () => {
    const o = await offer('AUTO_CHARGE');
    const c = await activate(o.id, 'declined@test.dev');
    const fail = { charge: async () => ({ outcome: 'FAILED' as const }) };
    await service.runDue(at(31), fail);
    const after = await db!.billingContract.findUniqueOrThrow({
      where: { id: c.id },
    });
    expect(after.status).toBe('PAST_DUE');
    expect(
      await db!.billingContractEvent.count({
        where: { contractId: c.id, type: 'CHARGE_DUE' },
      }),
    ).toBe(0);
  },
);

run(
  'a card revoked mid-life switches the contract to buyer-paid, also for an open charge',
  async () => {
    const o = await offer('AUTO_CHARGE');
    const c = await activate(o.id, 'revoked@test.dev');
    const card = await db!.storedCard.findFirstOrThrow({
      where: { contractId: c.id },
    });
    let calls = 0;
    const unknown = {
      charge: async () => {
        calls++;
        return { outcome: 'UNKNOWN' as const };
      },
    };
    // Cycle opened by the card executor (ambiguous outcome), then the card is revoked.
    await service.runDue(at(31), unknown);
    expect(calls).toBe(1);
    expect(
      await db!.billingContractEvent.count({
        where: { contractId: c.id, type: 'CHARGE_DUE' },
      }),
    ).toBe(0);
    await db!.storedCard.update({
      where: { id: card.id },
      data: { status: 'REVOKED', revokedAt: at(31) },
    });
    await service.runDue(at(32), unknown);
    await service.runDue(at(33), unknown);
    expect(calls).toBe(1);
    expect(
      await db!.billingContractEvent.count({
        where: { contractId: c.id, type: 'CHARGE_DUE' },
      }),
    ).toBe(1);
    const late = await service.runDue(at(40), unknown);
    expect(late.expired).toBeGreaterThanOrEqual(1);
    expect(
      (await db!.billingContract.findUniqueOrThrow({ where: { id: c.id } }))
        .status,
    ).toBe('SUSPENDED');
  },
);

run('an expired stored card counts as no card', async () => {
  const o = await offer('AUTO_CHARGE');
  const c = await activate(o.id, 'expiredcard@test.dev', false);
  await giveStoredCard(db!, c, 'DOM', 2025);
  let calls = 0;
  const res = await service.runDue(at(31), {
    charge: async () => {
      calls++;
      return { outcome: 'PAID' as const };
    },
  });
  expect(calls).toBe(0);
  expect(res.awaitingBuyer).toBeGreaterThanOrEqual(1);
});
