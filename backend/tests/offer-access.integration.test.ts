import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { markChargeSettled } from '../src/modules/billing-core/charge-settlement';
import { findOfferByAlias } from '../src/modules/offer-access/find-offer-by-alias';
import { OfferAccessEventsService } from '../src/modules/offer-access/offer-access-events.service';
import { OfferAccessReminderService } from '../src/modules/offer-access/offer-access-reminder.service';
import { OfferAccessService } from '../src/modules/offer-access/offer-access.service';
import {
  PagatgNotifier,
  type PagatgCreditPayload,
} from '../src/modules/offer-access/pagatg-notifier';
import { frequencyOfOffer } from '../src/modules/offer-access/offer-access.compat.service';

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
const t0 = new Date('2026-01-01T12:00:00.000Z');
const at = (days: number) => new Date(t0.getTime() + days * day);
const uid = () => crypto.randomUUID().slice(0, 8);

let ownerId: string;
let sent: PagatgCreditPayload[] = [];
let notifierFails = false;
const notifier = new PagatgNotifier();
// The real notifier swallows failures; replace only the notify() edge to record payloads.
(notifier as any).notify = async (payload: PagatgCreditPayload) => {
  if (notifierFails) return false;
  sent.push(payload);
  return true;
};
let service: OfferAccessService;

async function offer(over: Record<string, unknown> = {}, alias = true) {
  const o = await db!.offer.create({
    data: {
      ownerUserId: ownerId,
      createdByUserId: ownerId,
      code: `A${uid().toUpperCase()}`,
      name: 'Credito',
      amountCents: 4990,
      acceptedMethods: ['PIX'],
      renewalMode: 'MANUAL_PAY',
      intervalType: 'MONTH',
      intervalCount: 1,
      metadata: { pixPlan: { kind: 'PLAN' } },
      ...over,
    } as never,
  });
  if (alias)
    await db!.offerCodeAlias.create({
      data: { offerId: o.id, kind: 'PX', code: `PX-${uid().toUpperCase()}` },
    });
  return o;
}

/** A PENDING PIX charge with its Transaction, settled like the webhook does. */
async function charge(
  o: { id: string },
  buyer: { email: string; document: string },
) {
  const tx = await db!.transaction.create({
    data: {
      userId: ownerId,
      amount: '49.90',
      status: 'PENDING',
      paymentMethod: 'PIX',
      domPaymentId: `pix-${uid()}`,
    },
  });
  const c = await db!.charge.create({
    data: {
      offerId: o.id,
      ownerUserId: ownerId,
      amountCents: 4990,
      status: 'PENDING',
      method: 'PIX',
      customerName: 'Ana',
      customerEmail: buyer.email,
      customerDocument: buyer.document,
      transactionId: tx.id,
    },
  });
  return { tx, charge: c };
}

const pay = (transactionId: string, now = t0) =>
  db!.$transaction(async (p) => {
    await p.transaction.update({
      where: { id: transactionId },
      data: { status: 'COMPLETED' },
    });
    return markChargeSettled(p, transactionId, 'COMPLETED', now);
  });

const buyerOf = () => ({
  email: `b-${uid()}@test.dev`,
  document: String(10000000000 + Math.floor(Math.random() * 89999999999)),
});
const accessOf = (offerId: string, document: string) =>
  db!.offerAccess.findUniqueOrThrow({
    where: {
      offerId_customerDocument: { offerId, customerDocument: document },
    },
  });

beforeAll(async () => {
  if (!db) return;
  ownerId = (
    await db.user.create({
      data: {
        name: 'Seller',
        email: `seller-${uid()}@test.dev`,
        password: 'x',
        role: 'USER',
        clientStatus: 'APPROVED',
      },
    })
  ).id;
  service = new OfferAccessService(
    db as never,
    notifier,
    new OfferAccessEventsService(),
  );
});
afterAll(async () => {
  await db?.$disconnect();
});

run(
  'credits once per paid charge, even when the settlement is replayed',
  async () => {
    const o = await offer();
    const b = buyerOf();
    const { tx } = await charge(o, b);
    await pay(tx.id);
    expect(await service.creditForTransaction(tx.id, t0)).toBe('credited');
    expect(await service.creditForTransaction(tx.id, at(1))).toBe('duplicate');
    expect(await service.creditForTransaction(tx.id, at(2))).toBe('duplicate');
    const access = await accessOf(o.id, b.document);
    expect(access.totalDaysCredited).toBe(30);
    expect(access.expiresAt).toEqual(at(30));
    expect(access.isActive).toBe(true);
    expect(access.customerId).toBeTruthy();
    const events = await db!.offerAccessEvent.count({
      where: { accessId: access.id, type: 'CREDIT' },
    });
    expect(events).toBe(1);
  },
);

run(
  'does not credit a charge that is not paid yet or is a one-off offer without renewal',
  async () => {
    const o = await offer();
    const { tx } = await charge(o, buyerOf());
    expect(await service.creditForTransaction(tx.id, t0)).toBe('retry');
    const plain = await offer(
      { renewalMode: 'NONE', intervalType: null, intervalCount: null },
      false,
    );
    const other = await charge(plain, buyerOf());
    await pay(other.tx.id);
    expect(await service.creditForTransaction(other.tx.id, t0)).toBe('skipped');
  },
);

run('stacks a second payment on the remaining time', async () => {
  const o = await offer();
  const b = buyerOf();
  const first = await charge(o, b);
  await pay(first.tx.id);
  await service.creditForTransaction(first.tx.id, t0);
  const second = await charge(o, b);
  await pay(second.tx.id, at(10));
  await service.creditForTransaction(second.tx.id, at(10));
  const access = await accessOf(o.id, b.document);
  expect(access.totalDaysCredited).toBe(60);
  expect(access.expiresAt).toEqual(at(60));
  expect(access.lastTransactionId).toBe(second.tx.id);
});

run('credits through the settlement listener', async () => {
  const o = await offer();
  const b = buyerOf();
  const { tx } = await charge(o, b);
  service.onModuleInit();
  try {
    await pay(tx.id);
    for (let i = 0; i < 40; i++) {
      if (await db!.offerAccess.findFirst({ where: { offerId: o.id } })) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect((await accessOf(o.id, b.document)).totalDaysCredited).toBe(30);
  } finally {
    service.onModuleDestroy();
  }
});

run(
  'decrement-all expires due accesses once and notifies SUSPENDED',
  async () => {
    sent = [];
    const o = await offer();
    const b = buyerOf();
    const { tx } = await charge(o, b);
    await pay(tx.id);
    await service.creditForTransaction(tx.id, t0);
    const live = await service.decrementAll(at(10));
    expect(
      live.details.find((d) => d.customerEmail === b.email)?.afterDays,
    ).toBe(20);
    expect((await accessOf(o.id, b.document)).isActive).toBe(true);

    const expired = await service.decrementAll(at(31));
    expect(expired.expired).toBeGreaterThanOrEqual(1);
    expect((await accessOf(o.id, b.document)).isActive).toBe(false);
    expect(
      sent.filter((p) => p.email === b.email && p.status === 'SUSPENDED'),
    ).toHaveLength(1);
    const again = await service.decrementAll(at(32));
    expect(again.details.some((d) => d.customerEmail === b.email)).toBe(false);
    expect(
      sent.filter((p) => p.email === b.email && p.status === 'SUSPENDED'),
    ).toHaveLength(1);
  },
);

run('suspends and resumes, notifying ACTIVE/SUSPENDED', async () => {
  sent = [];
  const o = await offer();
  const b = buyerOf();
  const { tx } = await charge(o, b);
  await pay(tx.id);
  await service.creditForTransaction(tx.id, new Date());
  const a = await accessOf(o.id, b.document);
  const suspended = await service.toggleStatus(a.id);
  expect(suspended).toMatchObject({
    success: true,
    remainingDaysSuspended: 30,
  });
  const frozen = await accessOf(o.id, b.document);
  expect(frozen.isActive).toBe(false);
  expect(frozen.frozenDays).toBe(30);
  expect(frozen.totalDaysCredited).toBe(30);
  const resumed = await service.toggleStatus(a.id);
  expect(resumed).toMatchObject({ success: true, daysReturned: 30 });
  expect((await accessOf(o.id, b.document)).isActive).toBe(true);
  expect(sent.map((p) => p.status)).toEqual([
    'COMPLETED',
    'SUSPENDED',
    'ACTIVE',
  ]);
  expect(sent[0]).toMatchObject({ email: b.email, userId: ownerId });
  expect(sent[0].code).toMatch(/^PX-/);
});

run(
  'force-state-by-customer freezes and restores without notifying',
  async () => {
    sent = [];
    const o = await offer();
    const b = buyerOf();
    const { tx } = await charge(o, b);
    await pay(tx.id);
    await service.creditForTransaction(tx.id, new Date());
    const a = await accessOf(o.id, b.document);
    sent = [];
    expect(
      await service.forceStateByCustomer(a.customerId!, false, 12),
    ).toEqual({
      success: true,
      updated: 1,
    });
    expect(await accessOf(o.id, b.document)).toMatchObject({
      isActive: false,
      frozenDays: 12,
    });
    expect(await service.forceStateByCustomer(a.customerId!, true, 0)).toEqual({
      success: true,
      updated: 1,
    });
    const back = await accessOf(o.id, b.document);
    expect(back.isActive).toBe(true);
    expect(back.frozenDays).toBe(0);
    expect(sent).toHaveLength(0);
  },
);

run('a failing PAGATG notification never breaks the credit', async () => {
  notifierFails = true;
  try {
    const o = await offer();
    const b = buyerOf();
    const { tx } = await charge(o, b);
    await pay(tx.id);
    expect(await service.creditForTransaction(tx.id, t0)).toBe('credited');
    expect((await accessOf(o.id, b.document)).isActive).toBe(true);
    const event = await db!.offerAccessEvent.findFirstOrThrow({
      where: {
        eventKey: { startsWith: 'credit:' },
        accessId: (await accessOf(o.id, b.document)).id,
      },
    });
    expect(event.lastError).toBe('pagatg-not-notified');
  } finally {
    notifierFails = false;
  }
});

run('offers without the PIX origin never notify PAGATG', async () => {
  sent = [];
  const o = await offer({ metadata: null }, false);
  const b = buyerOf();
  const { tx } = await charge(o, b);
  await pay(tx.id);
  await service.creditForTransaction(tx.id, t0);
  expect(sent).toHaveLength(0);
});

run(
  'credits paid cycle charges that never emitted the settlement event',
  async () => {
    const o = await offer();
    const b = buyerOf();
    const { tx, charge: c } = await charge(o, b);
    // Reconciler path: PAID without markChargeSettled.
    await db!.charge.update({
      where: { id: c.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    const first = await service.creditMissed(new Date());
    expect(first.credited).toBeGreaterThanOrEqual(1);
    expect((await accessOf(o.id, b.document)).lastTransactionId).toBe(tx.id);
    const second = await service.creditMissed(new Date());
    expect(second.credited).toBe(0);
  },
);

run(
  'alias lookup resolves PX codes to their offer and ignores inactive ones',
  async () => {
    const o = await offer();
    const alias = await db!.offerCodeAlias.findFirstOrThrow({
      where: { offerId: o.id },
    });
    expect((await findOfferByAlias(db as never, alias.code))?.id).toBe(o.id);
    await db!.offerCodeAlias.update({
      where: { id: alias.id },
      data: { isActive: false },
    });
    expect(await findOfferByAlias(db as never, alias.code)).toBeNull();
    expect(await findOfferByAlias(db as never, 'PX-NOPE')).toBeNull();
  },
);

run(
  'expiry reminders are sent once per access, expiry and offset',
  async () => {
    const o = await offer();
    const b = buyerOf();
    const { tx } = await charge(o, b);
    await pay(tx.id);
    await service.creditForTransaction(tx.id, t0);
    const emails: any[] = [];
    let fail = true;
    const reminders = new OfferAccessReminderService(
      db as never,
      {
        sendExpirationReminder: async (i: any) => {
          if (fail) throw new Error('smtp down');
          emails.push(i);
        },
      } as never,
    );
    const now = at(28); // expires in 2 days
    const failed = await reminders.run(now);
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    fail = false;
    const retried = await reminders.run(now);
    expect(retried.sent).toBeGreaterThanOrEqual(1);
    expect(emails.filter((e) => e.to === b.email)).toHaveLength(1);
    const replay = await reminders.run(now);
    expect(replay.sent).toBe(0);
    expect(emails.filter((e) => e.to === b.email)).toHaveLength(1);
  },
);

run('the offer interval maps back to the legacy frequency', async () => {
  expect(frequencyOfOffer({ intervalType: 'MONTH', intervalCount: 6 })).toBe(
    'SEMESTER',
  );
  expect(frequencyOfOffer({ intervalType: 'YEAR', intervalCount: 1 })).toBe(
    'YEAR',
  );
});
