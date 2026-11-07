import { describe, expect, test } from 'bun:test';
import {
  OfferFulfillmentService,
  type DeliveryStep,
  type FulfillmentMarkers,
} from './offer-fulfillment.service';
import type {
  OfferSalesEvent,
  OfferSalesEventOutbox,
} from './offer-sales-event-outbox';
import { PrismaOfferSalesEventOutbox } from './offer-sales-event-outbox';

type Over = {
  renewalMode?: string;
  contractId?: string | null;
  firstPaidId?: string;
  netAmount?: number | null;
  enqueue?: (event: OfferSalesEvent) => Promise<boolean>;
};

function setup(over: Over = {}) {
  const offer = {
    id: 'offer-1',
    name: 'Plano Mensal',
    amountCents: 3990,
    platformTag: 'AREAFLIX',
    renewalMode: over.renewalMode ?? 'AUTO_CHARGE',
    intervalType: 'MONTH',
    intervalCount: 1,
    fulfillment: null,
  };
  const charge: any = {
    id: 'charge-2',
    offerId: 'offer-1',
    contractId: over.contractId === undefined ? 'ctr-1' : over.contractId,
    status: 'PAID',
    transactionId: 'tx-1',
    paidAt: new Date('2026-02-03T04:05:06Z'),
    customerEmail: 'ana@test.dev',
    customerName: 'Ana',
    customerDocument: '123.456.789-09',
    snapshot: {},
  };
  const tx = {
    id: 'tx-1',
    status: 'COMPLETED',
    paymentMethod: 'CREDIT_CARD',
    amount: 39.9,
    netAmount: over.netAmount === undefined ? 36.5 : over.netAmount,
    customerPhone: '11999999999',
  };
  const prisma: any = {
    charge: {
      findUnique: async () => charge,
      findFirst: async () => ({ id: over.firstPaidId ?? 'charge-2' }),
    },
    transaction: { findUnique: async () => tx },
    offer: {
      findUnique: async () => offer,
      findMany: async () => [offer],
    },
  };
  const claimed = new Set<string>();
  const markers: FulfillmentMarkers = {
    claim: async (id: string, step: DeliveryStep) => {
      const key = `${id}:${step}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    release: async (id: string, step: DeliveryStep) => {
      claimed.delete(`${id}:${step}`);
    },
  };
  const events: OfferSalesEvent[] = [];
  const outbox: OfferSalesEventOutbox = {
    enqueue:
      over.enqueue ??
      (async (event) => {
        events.push(event);
        return true;
      }),
  };
  const service = new OfferFulfillmentService(
    prisma,
    markers,
    undefined,
    undefined,
    outbox,
  );
  return { service, events, claimed };
}

const paid = { transactionId: 'tx-1', kind: 'PAID' as const };

describe('subscription_activated', () => {
  test('first paid cycle of a recurring offer emits the legacy payload', async () => {
    const f = setup();
    expect(await f.service.deliver(paid)).toBe('done');
    expect(f.events).toHaveLength(1);
    const [event] = f.events;
    expect(event).toMatchObject({
      platformTag: 'AREAFLIX',
      event: 'subscription_activated',
      orderId: 'tx-1',
    });
    expect(event.occurredAt).toEqual(new Date('2026-02-03T04:05:06Z'));
    expect(event.payload).toEqual({
      customerEmail: 'ana@test.dev',
      customerName: 'Ana',
      planName: 'Plano Mensal',
      paymentMethod: 'CREDIT_CARD',
      frequencyType: 'MONTHLY',
      amountCharged: 39.9,
      netAmount: 36.5,
      amountCents: 3990,
      netAmountCents: 3650,
      orderId: 'tx-1',
      offerId: 'offer-1',
      chargeId: 'charge-2',
      contractId: 'ctr-1',
      linkId: 'offer-1',
      phone: '11999999999',
    });
  });

  test('is sent once per contract charge even if settlement is replayed', async () => {
    const f = setup();
    await f.service.deliver(paid);
    await f.service.deliver(paid);
    expect(f.events).toHaveLength(1);
  });

  test('later cycles do not re-send', async () => {
    const f = setup({ firstPaidId: 'charge-1' });
    expect(await f.service.deliver(paid)).toBe('done');
    expect(f.events).toHaveLength(0);
  });

  test('one-off offers and charges without a contract send nothing', async () => {
    const oneOff = setup({ renewalMode: 'NONE' });
    await oneOff.service.deliver(paid);
    expect(oneOff.events).toHaveLength(0);
    const noContract = setup({ contractId: null });
    await noContract.service.deliver(paid);
    expect(noContract.events).toHaveLength(0);
  });

  test('refunds do not emit it', async () => {
    const f = setup();
    // A refunded transaction needs the REFUNDED status on the fake.
    (f.service as any).prisma.transaction.findUnique = async () => ({
      id: 'tx-1',
      status: 'REFUNDED',
      paymentMethod: 'CREDIT_CARD',
      amount: 39.9,
      netAmount: 36.5,
    });
    await f.service.deliver({ transactionId: 'tx-1', kind: 'REFUNDED' });
    expect(f.events).toHaveLength(0);
  });

  test('waits for the net amount instead of sending a partial contract', async () => {
    const f = setup({ netAmount: null });
    expect(await f.service.deliver(paid)).toBe('retry');
    expect(f.events).toHaveLength(0);
    expect(f.claimed.size).toBe(0);
  });

  test('an outbox failure releases the marker so the next attempt retries', async () => {
    let fail = true;
    const sent: OfferSalesEvent[] = [];
    const f = setup({
      enqueue: async (event) => {
        if (fail) throw new Error('db down');
        sent.push(event);
        return true;
      },
    });
    expect(await f.service.deliver(paid)).toBe('done'); // failure is isolated
    expect(f.claimed.size).toBe(0);
    fail = false;
    await f.service.deliver(paid);
    expect(sent).toHaveLength(1);
  });
});

describe('PrismaOfferSalesEventOutbox', () => {
  function build(platform: any, resolved: string[] = ['93.184.216.34']) {
    const inserts: unknown[][] = [];
    const prisma: any = {
      platform: { findUnique: async () => platform },
      $executeRaw: async (...args: unknown[]) => {
        inserts.push(args);
        return 1;
      },
    };
    const outbox = new PrismaOfferSalesEventOutbox(prisma);
    outbox.resolve = async () => resolved;
    return { outbox, inserts };
  }
  const platform = (url: string | null, over: any = {}) => ({
    id: 'p-1',
    tag: 'AREAFLIX',
    isActive: true,
    owner: { isActive: true, isPurged: false },
    integrations: [
      { key: 'WEBHOOK_SECRET', encryptedValue: 'enc' },
      ...(url ? [{ key: 'WEBHOOK_URL', url }] : []),
    ],
    ...over,
  });
  const event: OfferSalesEvent = {
    platformTag: 'AREAFLIX',
    event: 'subscription_activated',
    orderId: 'tx-1',
    occurredAt: new Date('2026-02-03T00:00:00Z'),
    payload: { planName: 'x' },
  };

  test('queues the signed event on the platform webhook', async () => {
    const { outbox, inserts } = build(platform('https://hook.example.com/in'));
    expect(await outbox.enqueue(event)).toBe(true);
    expect(inserts).toHaveLength(1);
    const values = inserts[0].slice(1);
    expect(values[1]).toBe('p-1');
    expect(values[2]).toBe('https://hook.example.com/in');
    expect(JSON.parse(values[3] as string)).toMatchObject({
      event: 'subscription_activated',
      planName: 'x',
      occurredAt: '2026-02-03T00:00:00.000Z',
    });
  });

  test('skips offers without a platform or webhook', async () => {
    const none = build(platform(null));
    expect(await none.outbox.enqueue(event)).toBe(true);
    expect(none.inserts).toHaveLength(0);
    const noPlatform = build(platform('https://hook.example.com/in'));
    await noPlatform.outbox.enqueue({ ...event, platformTag: null });
    expect(noPlatform.inserts).toHaveLength(0);
  });

  test('blocks internal addresses (URL and DNS) like the old webhook step', async () => {
    for (const url of [
      'http://localhost/in',
      'https://10.0.0.5/in',
      'https://user:pw@hook.example.com/in',
    ]) {
      const { outbox, inserts } = build(platform(url));
      await outbox.enqueue(event);
      expect(inserts).toHaveLength(0);
    }
    const rebinding = build(platform('https://hook.example.com/in'), [
      '169.254.169.254',
    ]);
    await rebinding.outbox.enqueue(event);
    expect(rebinding.inserts).toHaveLength(0);
  });
});
