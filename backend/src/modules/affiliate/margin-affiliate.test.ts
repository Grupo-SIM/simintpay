import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { marginCents, marginCommission } from './margin-affiliate';
import { snapshotFrom } from '../coproduction/coproduction';

const sale = (realizedCents?: number) => ({
  buyerTotalCents: 11000,
  ...(realizedCents === undefined ? {} : { acquirerCost: { realizedCents } }),
});

test('margin is buyer total minus merchant net minus realized acquirer cost', () => {
  expect(marginCents(sale(300), '110.00', new Prisma.Decimal('100.00'))).toBe(
    700,
  );
});

test('unknown realized cost or a losing sale yields zero margin', () => {
  expect(marginCents(sale(), '110.00', '100.00')).toBe(0);
  expect(marginCents(sale(1500), '110.00', '100.00')).toBe(0);
  expect(marginCents(sale(300), '110.00', null)).toBe(0);
});

test('commission floors to the cent over the margin', () => {
  expect(marginCommission(701, 5000).toString()).toBe('3.5');
  expect(marginCommission(701, 3333).toString()).toBe('2.33');
  expect(marginCommission(0, 10000).toString()).toBe('0');
});

test('snapshot accepts a margin affiliate alongside the full net split', () => {
  const snapshot = snapshotFrom({
    coproduction: {
      basis: 'NET',
      version: 0,
      product: 'plataformas',
      productId: 'p',
      ownerUserId: 'owner',
      participants: [{ userId: 'co', percentageBps: 10000 }],
      marginAffiliate: {
        userId: 'aff',
        code: 'abc',
        platformId: 'p',
        percentageBps: 10000,
        level: 'platform',
        versions: {},
        commissionOnRenewals: true,
      },
    },
  });
  expect(snapshot?.marginAffiliate?.userId).toBe('aff');
  expect(() =>
    snapshotFrom({
      coproduction: {
        basis: 'NET',
        ownerUserId: 'owner',
        participants: [],
        marginAffiliate: { userId: 'owner', percentageBps: 100 },
      },
    }),
  ).toThrow();
});
