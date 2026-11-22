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

test('platform offering keeps buyer 1500 and deducts the current 695 fee, not grossing up', async () => {
  const quote = quoteFinancialCharge(
    context('SIMINTPAY_ONLY'),
    15,
    'CREDIT_CARD',
  )!;
  expect(quote.totalAmount).toBe(15);
  expect(quote.netAmount).toBe(8.05);
  expect(quote.financialSnapshot.contractedCostCents).toBe(695);
  expect(quote.financialSnapshot.acquirerCost?.realizedCents).toBe(160);
  const restored = await restoreFinancialCharge(
    { financialPolicyRevision: { findMany: async () => [] } } as any,
    quote.financialSnapshot as any,
  );
  expect(restored?.totalAmount).toBe(15);
  expect(restored?.netAmount).toBe(8.05);
});

test('additive-only charges the seller nothing and adds the additive to the buyer', () => {
  const quote = quoteFinancialCharge(
    context('ADDITIVE_ONLY'),
    15,
    'CREDIT_CARD',
  )!;
  expect(quote.totalAmount).toBe(15.5);
  expect(quote.netAmount).toBe(15);
  const snapshot = quote.financialSnapshot as Record<string, unknown>;
  expect(snapshot.additiveFeeCents).toBe(50);
  expect(snapshot.sellerFeeCents).toBe(0);
  expect(snapshot.acquirerCostBorneBySimCents).toBe(162);
  expect(quote.platformProfit).toBe(-1.12);
});

test('both keeps the seller fee and adds the order additive to the buyer', () => {
  const ctx = context('BOTH');
  const quote = quoteFinancialCharge(ctx, 15, 'CREDIT_CARD')!;
  expect(quote.totalAmount).toBe(15.5);
  expect(quote.netAmount).toBe(8.05);
  ctx.additiveTotals.product.fixedValue = 10;
  expect(() => quoteFinancialCharge(ctx, 15, 'CREDIT_CARD')).toThrow(
    'base explícita',
  );
  const items = quoteFinancialCharge(ctx, 15, 'CREDIT_CARD', 1, 'ONLINE', [
    { key: 'a', quantity: 2, unitPrice: 500 },
    { key: 'frete', quantity: 1, unitPrice: 500 },
  ])!;
  // Order 50 + product 10 per unit (3 units).
  expect(items.financialSnapshot.additiveFeeCents).toBe(80);
  expect(items.totalAmount).toBe(15.8);
});

function installmentContext(
  mode: 'SIMINTPAY_ONLY' | 'ADDITIVE_ONLY' | 'BOTH',
  targetFeePpm?: number,
) {
  const key = 'DOM/CREDIT_CARD/ONLINE/3';
  const document = emptyPolicy();
  document.lanes[key] = {
    active: true,
    contract: {
      fixedCents: 100,
      ratePpm: 39900,
      interestPpm: 30000,
      cashbackCents: 0,
      base: 'BUYER_TOTAL',
      reference: 'test',
    },
    sim: { fixedCents: 0, ratePpm: 0, interestPpm: 0 },
  };
  document.owner[key] = {
    fixedCents: 0,
    ratePpm: 0,
    passInterestPpm: 1_000_000,
  };
  return {
    policy: resolvePolicy(document, emptyPolicy(), '4:3'),
    tag: 'RENOVADA',
    acquirer: 'DOM',
    platformFeeMode: mode,
    ...(targetFeePpm !== undefined ? { targetFeePpm } : {}),
    feesByLane: {
      'CREDIT_CARD/ONLINE/3': [{ ...routed, interestPpm: 30000 }],
    },
    additiveTotals: {
      order: { fixedValue: 0, percentageValue: 500 },
      product: { fixedValue: 0, percentageValue: 0 },
    },
  };
}

test('additive-only passes interest to the buyer and ignores the target fee', () => {
  const quote = quoteFinancialCharge(
    installmentContext('ADDITIVE_ONLY', 50_000),
    100,
    'CREDIT_CARD',
    3,
  )!;
  // Base 100 + passed interest 3 + additive 5; the seller keeps the base.
  expect(quote.totalAmount).toBe(108);
  expect(quote.netAmount).toBe(100);
  expect(quote.financialSnapshot.buyerInterestCents).toBe(300);
  // Acquirer 100 + 3.99% of 108 + 3 interest = 8.31, of which 3 the buyer paid as interest.
  expect(quote.financialSnapshot.acquirerCostBorneBySimCents).toBe(531);
  expect(quote.platformProfit).toBe(-0.31);
});

test('both with target fee: seller pays the target, buyer pays interest and additive', () => {
  const quote = quoteFinancialCharge(
    installmentContext('BOTH', 50_000),
    100,
    'CREDIT_CARD',
    3,
  )!;
  expect(quote.totalAmount).toBe(108);
  expect(quote.netAmount).toBe(95);
});

test('insufficient merchant net is rejected before dispatch', () => {
  expect(() =>
    quoteFinancialCharge(context('SIMINTPAY_ONLY'), 1, 'CREDIT_CARD'),
  ).toThrow('Valor insuficiente');
});
