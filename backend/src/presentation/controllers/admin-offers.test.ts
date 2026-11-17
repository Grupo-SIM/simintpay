import { expect, test } from 'bun:test';
import {
  areaflixOfferIds,
  chargeStatusesOf,
  listAreaflixOfferOrders,
  paidAreaflixEmails,
} from './admin-areaflix-offers';
import { offerAuditRow, offerGroupWhere } from './admin-clientes-offers';

test('legacy order status words map to charge statuses', () => {
  for (const word of ['paid', 'active', 'approved', 'PAID'])
    expect(chargeStatusesOf(word)).toEqual(['PAID']);
  expect(chargeStatusesOf('pending')).toEqual(['PENDING']);
  expect(chargeStatusesOf('nonsense')).toEqual([]);
});

test('AreaFlix orders: recurring AREAFLIX offers, charges shown as legacy orders', async () => {
  const offerWhere: unknown[] = [];
  const db = {
    offer: {
      findMany: async (args: { where: unknown }) => {
        offerWhere.push(args.where);
        return [{ id: 'o1' }];
      },
    },
    charge: {
      count: async () => 2,
      findMany: async (args: { where: { status?: unknown } }) =>
        args.where.status === 'PAID'
          ? [
              { amountCents: 1000, transaction: { platformFee: 1.5 } },
              { amountCents: 500, transaction: null },
            ]
          : [
              {
                id: 'c1',
                offerId: 'o1',
                customerName: 'A',
                customerEmail: 'a@x.com',
                customerDocument: null,
                method: 'PIX',
                status: 'PAID',
                amountCents: 1000,
                createdAt: new Date(0),
                transaction: { platformFee: 1.5 },
                offer: { name: 'N', amountCents: 1000, intervalType: 'MONTH' },
              },
            ],
    },
  } as never;
  expect(await areaflixOfferIds(db)).toEqual(['o1']);
  expect(offerWhere[0]).toEqual({
    platformTag: 'AREAFLIX',
    renewalMode: { not: 'NONE' },
  });
  const listed = await listAreaflixOfferOrders(db, { skip: 0, take: 50 });
  expect(listed.total).toBe(2);
  expect(listed.totalRevenue).toBe(15);
  expect(listed.totalFee).toBe(1.5);
  expect(listed.items[0]).toMatchObject({
    subscriptionLinkId: 'o1',
    status: 'paid',
    amountCharged: 10,
    platformFeeAmount: 1.5,
  });
});

test('AreaFlix emails come from paid charges only', async () => {
  const db = {
    offer: { findMany: async () => [{ id: 'o1' }] },
    charge: {
      findMany: async (args: { where: { status: string } }) => {
        expect(args.where.status).toBe('PAID');
        return [{ customerEmail: 'a@x.com' }];
      },
    },
  } as never;
  expect([...(await paidAreaflixEmails(db, ['a@x.com']))]).toEqual(['a@x.com']);
});

test('audit groups split by the metadata origin and recurrence; rows keep the legacy shape', () => {
  expect(offerGroupWhere('plan')).toEqual({
    metadata: { path: ['legacyType'], equals: 'Plan' },
  });
  expect(offerGroupWhere('pixPlan')).toEqual({
    metadata: { path: ['legacyType'], equals: 'PixCreditPlan' },
  });
  expect(offerGroupWhere('paymentLink').renewalMode).toBe('NONE');
  expect(offerGroupWhere('subscriptionLink').renewalMode).toEqual({
    not: 'NONE',
  });
  const row = offerAuditRow(
    {
      id: 'x',
      code: 'c',
      name: 'Curso',
      description: null,
      amountCents: 1999,
      isActive: true,
      platformTag: 'T',
      createdAt: new Date(0),
      ownerUserId: 'u',
      owner: { id: 'u', name: 'N', email: 'e' },
    },
    'paymentLink',
  );
  expect(row).toMatchObject({
    id: 'x',
    title: 'Curso',
    amount: 19.99,
    userId: 'u',
    plataformas: ['T'],
  });
});
