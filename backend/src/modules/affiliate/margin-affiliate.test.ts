import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import {
  effectiveCoproducers,
  marginCents,
  marginCommission,
  marginWorstCaseBps,
  validateMarginInput,
  type MarginAffiliateConfig,
} from './margin-affiliate';
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

const config = (
  partial: Partial<MarginAffiliateConfig>,
): MarginAffiliateConfig => ({
  version: 1,
  defaultPercentageBps: null,
  commissionOnRenewals: true,
  linkBaseUrl: null,
  affiliates: [],
  coproducers: [],
  ...partial,
});

test('offer coproducer percentage wins over the platform one for the same person', () => {
  const platform = config({
    coproducers: [
      { userId: 'a', percentageBps: 1000 },
      { userId: 'b', percentageBps: 500 },
    ],
  });
  const offer = config({ coproducers: [{ userId: 'a', percentageBps: 2000 }] });
  expect(effectiveCoproducers(offer, platform)).toEqual([
    { userId: 'a', percentageBps: 2000 },
    { userId: 'b', percentageBps: 500 },
  ]);
});

test('worst case adds coproducers and the best affiliate who is not a coproducer', () => {
  const platform = config({
    coproducers: [{ userId: 'co', percentageBps: 6000 }],
    affiliates: [
      { userId: 'co', percentageBps: 9000 },
      { userId: 'x', percentageBps: 3000 },
    ],
  });
  expect(marginWorstCaseBps(null, platform)).toBe(9000);
  expect(
    marginWorstCaseBps(
      null,
      config({
        coproducers: [{ userId: 'co', percentageBps: 8000 }],
        affiliates: [{ userId: 'x', percentageBps: 3000 }],
      }),
    ),
  ).toBe(11000);
});

test('margin input validates coproducers and keeps the affiliate rules', () => {
  const ok = validateMarginInput(
    {
      version: 0,
      defaultPercentageBps: 1000,
      commissionOnRenewals: true,
      affiliates: [{ email: 'A@x.com', percentageBps: null }],
      coproducers: [{ email: 'B@x.com', percentageBps: 2500 }],
    },
    'plataformas',
  );
  expect(ok.coproducers).toEqual([{ email: 'b@x.com', percentageBps: 2500 }]);
  expect(() =>
    validateMarginInput(
      {
        version: 0,
        commissionOnRenewals: true,
        affiliates: [],
        coproducers: [
          { email: 'a@x.com', percentageBps: 6000 },
          { email: 'b@x.com', percentageBps: 4001 },
        ],
      },
      'plataformas',
    ),
  ).toThrow();
});
