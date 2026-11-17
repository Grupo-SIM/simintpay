import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { useEmptyCaches } from '../src/modules/offer/offer-charge.fixture';
import {
  OfferFulfillmentService,
  PrismaFulfillmentMarkers,
} from '../src/modules/offer/offer-fulfillment.service';
import { PrismaOfferSalesEventOutbox } from '../src/modules/offer/offer-sales-event-outbox';

setDefaultTimeout(60_000);
const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;

const realFetch = globalThis.fetch;
beforeAll(async () => {
  process.env.DOM_TOKEN = 'test-token';
  await useEmptyCaches();
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function setup() {
  const owner = await db!.user.create({
    data: {
      name: 'Seller',
      email: `seller-${crypto.randomUUID()}@test.dev`,
      password: 'x',
      role: 'USER',
      clientStatus: 'APPROVED',
    },
  });
  const tag = `HOOK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const platform = await db!.platform.create({
    data: { tag, name: tag, ownerUserId: owner.id },
  });
  await db!.platformIntegration.createMany({
    data: [
      { platformId: platform.id, key: 'WEBHOOK_SECRET', encryptedValue: 'x' },
      {
        platformId: platform.id,
        key: 'WEBHOOK_URL',
        url: 'https://hook.example.com/in',
      },
    ],
  });
  const offer = await db!.offer.create({
    data: {
      ownerUserId: owner.id,
      createdByUserId: owner.id,
      platformTag: tag,
      code: `S${crypto.randomUUID().slice(0, 9).toUpperCase()}`,
      name: 'Plano Mensal',
      amountCents: 3990,
      acceptedMethods: ['CREDIT_CARD', 'PIX'],
      renewalMode: 'AUTO_CHARGE',
      intervalType: 'MONTH',
      intervalCount: 1,
    },
  });
  const contract = await db!.billingContract.create({
    data: {
      userId: owner.id,
      resourceType: 'OFFER',
      resourceId: crypto.randomUUID(),
      offerId: offer.id,
      unitAmount: 39.9,
      quantity: 1,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      customerEmail: 'ana@test.dev',
    },
  });
  let n = 0;
  async function cycle(paidAt: Date, snapshot: object = {}) {
    n++;
    const tx = await db!.transaction.create({
      data: {
        userId: owner.id,
        amount: 39.9,
        netAmount: 39.9,
        status: 'COMPLETED',
        paymentMethod: 'CREDIT_CARD',
        customerEmail: 'ana@test.dev',
        customerName: 'Ana',
        customerDocument: '12345678909',
        customerPhone: '11999999999',
        platformTag: tag,
      },
    });
    const charge = await db!.charge.create({
      data: {
        offerId: offer.id,
        contractId: contract.id,
        ownerUserId: owner.id,
        amountCents: 3990,
        status: 'PAID',
        cycleKey: `c${n}`,
        paidAt,
        customerEmail: 'ana@test.dev',
        customerName: 'Ana',
        transactionId: tx.id,
        snapshot,
      },
    });
    return { tx, charge };
  }
  const outbox = new PrismaOfferSalesEventOutbox(db as never);
  outbox.resolve = async () => ['93.184.216.34'];
  const service = new OfferFulfillmentService(
    db as never,
    new PrismaFulfillmentMarkers(db as never),
    undefined,
    undefined,
    outbox,
  );
  const events = () =>
    db!.$queryRaw<{ payload: any }[]>`
      SELECT payload FROM "PlatformSalesEvent" WHERE "platformId" = ${platform.id} ORDER BY sequence`;
  return { offer, cycle, service, events };
}

run(
  'offer payload carries every field the saas-netflix-back reads',
  async () => {
    const f = await setup();
    const first = await f.cycle(new Date('2026-01-01T00:00:00Z'));
    await f.service.deliver({ transactionId: first.tx.id, kind: 'PAID' });
    const [event] = await f.events();
    const offerBody = event.payload;

    expect(offerBody.event).toBe('subscription_activated');
    for (const key of [
      'customerEmail',
      'customerName',
      'planName',
      'paymentMethod',
      'frequencyType',
      'amountCharged',
      'netAmount',
      'phone',
    ])
      expect(Object.keys(offerBody), key).toContain(key);
    // `linkId` is the old id, which an offer reuses.
    expect(offerBody.linkId).toBe(f.offer.id);
    expect(offerBody.orderId).toBe(first.tx.id);
  },
);

run(
  'idempotent per contract; a paid reactivation activates it again once',
  async () => {
    const f = await setup();
    const first = await f.cycle(new Date('2026-01-01T00:00:00Z'));
    const renewal = await f.cycle(new Date('2026-02-01T00:00:00Z'));
    const reactivation = await f.cycle(new Date('2026-04-01T00:00:00Z'), {
      reactivation: true,
    });
    for (const c of [first, first, renewal, reactivation, reactivation])
      await f.service.deliver({ transactionId: c.tx.id, kind: 'PAID' });

    const events = await f.events();
    expect(events.map((e) => e.payload.orderId)).toEqual([
      first.tx.id,
      reactivation.tx.id,
    ]);
    expect(events.every((e) => e.payload.linkId === f.offer.id)).toBe(true);
    expect(new Set(events.map((e) => e.payload.eventId)).size).toBe(2);
  },
);
