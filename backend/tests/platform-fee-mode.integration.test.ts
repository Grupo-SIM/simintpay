import { expect, test } from 'bun:test';
import {
  emptyPolicy,
  resolvePolicy,
} from '../src/modules/financial-policy/financial-policy';
import {
  quoteFinancialCharge,
  restoreFinancialCharge,
} from '../src/modules/financial-policy/financial-charge';

const date = new Date('2026-10-01T00:00:00Z');
const routed = {
  acquirer: 'DOM',
  fixedCents: 100,
  ratePpm: 39900,
  interestPpm: 0,
  base: 'BUYER_TOTAL' as const,
  source: 'API' as const,
  createdAt: date,
};
function context(mode: 'SIMINTPAY_ONLY' | 'ADDITIVE_ONLY' | 'BOTH') {
  const document = emptyPolicy();
  document.lanes['DOM/CREDIT_CARD/ONLINE/1'] = {
    active: true,
    contract: {
      fixedCents: 100,
      ratePpm: 39900,
      interestPpm: 0,
      cashbackCents: 0,
      base: 'BUYER_TOTAL',
      reference: 'test',
    },
    sim: { fixedCents: 400, ratePpm: 90000, interestPpm: 0 },
    priceFloor: {
      fees: [{ ...routed, ratePpm: 91500, createdAt: date.toISOString() }],
      sim: { fixedCents: 400, ratePpm: 90000, interestPpm: 0 },
    },
  };
  return {
    policy: resolvePolicy(document, emptyPolicy(), '4:3'),
    tag: 'RENOVADA',
    acquirer: 'DOM',
    platformFeeMode: mode,
    feesByLane: { 'CREDIT_CARD/ONLINE/1': [routed] },
    additiveTotals: {
      order: { fixedValue: 50, percentageValue: 0 },
      product: { fixedValue: 0, percentageValue: 0 },
    },
  };
}

test('platform offering keeps buyer 1500 and deducts frozen historical 772 fee, not grossing up to 2272', async () => {
  const quote = quoteFinancialCharge(
    context('SIMINTPAY_ONLY'),
    15,
    'CREDIT_CARD',
  )!;
  expect(quote.totalAmount).toBe(15);
  expect(quote.netAmount).toBe(7.28);
  expect(quote.financialSnapshot.contractedCostCents).toBe(772);
  expect(quote.financialSnapshot.acquirerCost?.realizedCents).toBe(160);
  const restored = await restoreFinancialCharge(
    { financialPolicyRevision: { findMany: async () => [] } } as any,
    quote.financialSnapshot as any,
  );
  expect(restored?.totalAmount).toBe(15);
  expect(restored?.netAmount).toBe(7.28);
});

test('additive-only retains acquiring cost but excludes SimIntPay excess and floor excess', () => {
  const quote = quoteFinancialCharge(
    context('ADDITIVE_ONLY'),
    15,
    'CREDIT_CARD',
  )!;
  expect(quote.totalAmount).toBe(15);
  expect(quote.netAmount).toBe(12.9);
});

test('both deducts configured order addition and rejects missing product basis', () => {
  const ctx = context('BOTH');
  expect(quoteFinancialCharge(ctx, 15, 'CREDIT_CARD')?.netAmount).toBe(6.78);
  ctx.additiveTotals.product.fixedValue = 10;
  expect(() => quoteFinancialCharge(ctx, 15, 'CREDIT_CARD')).toThrow(
    'base explícita',
  );
});

test('insufficient merchant net is rejected before dispatch', () => {
  expect(() =>
    quoteFinancialCharge(context('SIMINTPAY_ONLY'), 1, 'CREDIT_CARD'),
  ).toThrow('Valor insuficiente');
});
