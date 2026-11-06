import { describe, expect, test } from 'bun:test';
import { markChargeSettled } from '../billing-core/charge-settlement';
import {
  OfferFulfillmentService,
  type DeliveryStep,
  type FulfillmentMarkers,
} from './offer-fulfillment.service';

function setup(
  fulfillment: Record<string, unknown> | null,
  over: {
    items?: unknown[];
    chargeStatus?: string;
    txStatus?: string;
    extraOffers?: any[];
  } = {},
) {
  const offer = {
    id: 'offer-1',
    name: 'Curso',
    amountCents: 10000,
    legacyType: null,
    legacyId: null,
    fulfillment,
  };
  const charge: any = {
    id: 'charge-1',
    offerId: 'offer-1',
    status: over.chargeStatus ?? 'PAID',
    transactionId: 'tx-1',
    customerEmail: 'ana@test.dev',
    customerName: 'Ana',
    customerDocument: '123.456.789-09',
    snapshot: { items: over.items },
  };
  const tx = {
    id: 'tx-1',
    status: over.txStatus ?? 'COMPLETED',
    paymentMethod: 'PIX',
  };
  const offers = [offer, ...(over.extraOffers ?? [])];
  const prisma: any = {
    charge: { findUnique: async () => charge },
    transaction: { findUnique: async () => tx },
    offer: {
      findUnique: async ({ where }: any) =>
        offers.find((o) => o.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        offers.filter((o) => where.id.in.includes(o.id)),
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
  const emails: any[] = [];
  const email: any = {
    sendEbookAccessEmail: async (i: any) => emails.push(['ebook', i]),
    sendPaymentLinkFiles: async (i: any) => emails.push(['files', i]),
    sendPaymentLinkConfirmation: async (i: any) => emails.push(['confirm', i]),
  };
  const storage: any = {
    getReceiptBufferByStoredUrl: async () => ({ buffer: Buffer.from('pdf') }),
  };
  const service = new OfferFulfillmentService(prisma, markers, email, storage);
  return { service, emails, claimed, charge };
}

const full = {
  files: [
    { fileName: 'a.pdf', fileUrl: 'https://gateway.storjshare.io/a.pdf' },
  ],
  emailBody: 'Obrigado',
  redirectUrl: 'https://example.com/ok',
};

describe('OfferFulfillmentService', () => {
  test('PAID: sends the access e-mail with files and message', async () => {
    const f = setup(full);
    expect(
      await f.service.deliver({ transactionId: 'tx-1', kind: 'PAID' }),
    ).toBe('done');
    expect(f.emails).toHaveLength(1);
    expect(f.emails[0][0]).toBe('ebook');
    expect(f.emails[0][1]).toMatchObject({
      to: 'ana@test.dev',
      title: 'Curso',
      body: 'Obrigado',
      redirectUrl: 'https://example.com/ok',
    });
    expect(f.emails[0][1].attachments).toHaveLength(1);
  });

  test('a repeated settle does not re-send the e-mail', async () => {
    const f = setup(full);
    await f.service.deliver({ transactionId: 'tx-1', kind: 'PAID' });
    await f.service.deliver({ transactionId: 'tx-1', kind: 'PAID' });
    expect(f.emails).toHaveLength(1);
  });

  test('refund sends no e-mail', async () => {
    const f = setup(full, { txStatus: 'REFUNDED' });
    await f.service.deliver({ transactionId: 'tx-1', kind: 'REFUNDED' });
    expect(f.emails).toHaveLength(0);
  });

  test('waits (retry) while the settling commit is not visible yet', async () => {
    const f = setup(full, { chargeStatus: 'PENDING' });
    expect(
      f.service.deliver({ transactionId: 'tx-1', kind: 'PAID' }),
    ).resolves.toBe('retry');
    const r = setup(full, { txStatus: 'COMPLETED' });
    expect(
      await r.service.deliver({ transactionId: 'tx-1', kind: 'REFUNDED' }),
    ).toBe('retry');
  });

  test('order bumps add their material and items; funnel offers deliver only their own material', async () => {
    const bump = {
      id: 'bump-1',
      name: 'Bônus',
      fulfillment: {
        emailBody: 'Bônus aqui',
        files: [
          { fileName: 'b.pdf', fileUrl: 'https://gateway.storjshare.io/b.pdf' },
        ],
      },
    };
    const f = setup(full, {
      extraOffers: [bump],
      items: [
        {
          role: 'MAIN',
          offerId: 'offer-1',
          title: 'Curso',
          amountCents: 10000,
        },
        { role: 'BUMP', offerId: 'bump-1', title: 'Bônus', amountCents: 2000 },
      ],
    });
    await f.service.deliver({ transactionId: 'tx-1', kind: 'PAID' });
    expect(f.emails[0][1].title).toBe('Curso + Bônus');
    expect(f.emails[0][1].body).toBe('Obrigado\n\n— Bônus —\nBônus aqui');
    expect(f.emails[0][1].attachments).toHaveLength(2);

    const up = {
      id: 'offer-1',
      items: [
        {
          role: 'UPSELL',
          offerId: 'offer-1',
          title: 'Curso',
          amountCents: 5000,
        },
      ],
    };
    const g = setup({ emailBody: 'Só upsell' }, { items: up.items });
    await g.service.deliver({ transactionId: 'tx-1', kind: 'PAID' });
    expect(g.emails[0][1]).toMatchObject({
      body: 'Só upsell',
      redirectUrl: null,
    });
  });

  test('without fulfillment nothing is sent', async () => {
    const f = setup(null);
    await f.service.deliver({ transactionId: 'tx-1', kind: 'PAID' });
    expect(f.emails).toHaveLength(0);
  });
});

describe('markChargeSettled hook', () => {
  test('notifies listeners on the first PAID and on refunds, never on repeats', async () => {
    const { onChargeSettled } =
      await import('../billing-core/charge-settlement');
    const events: unknown[] = [];
    const off = onChargeSettled((e) => events.push(e));
    let pending = true;
    const p: any = {
      charge: {
        updateMany: async () => {
          const count = pending ? 1 : 0;
          pending = false;
          return { count };
        },
      },
    };
    await markChargeSettled(p, 'tx', 'COMPLETED');
    await markChargeSettled(p, 'tx', 'COMPLETED');
    await markChargeSettled(p, 'tx', 'FAILED');
    await markChargeSettled(p, 'tx', 'REFUNDED');
    off();
    await markChargeSettled(p, 'tx', 'CHARGEBACK');
    expect(events).toEqual([
      { transactionId: 'tx', kind: 'PAID' },
      { transactionId: 'tx', kind: 'REFUNDED' },
    ]);
  });
});
