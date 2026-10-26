import { describe, expect, test } from 'bun:test';
import { calculateFinancials, CHANNELS, defaultOwner, emptyPolicy, laneKey, METHODS, ownerResult, resolvePolicy, validatePolicy, type Lane } from './financial-policy';
import { quoteFinancialCharge, restoreFinancialCharge } from './financial-charge';

const lane = (credit = true): Lane => ({ active: true, contract: { fixedCents: 100, ratePpm: 20_000, cashbackCents: 15, interestPpm: credit ? 40_000 : 0, base: 'ORIGINAL', reference: 'Signed 2026-10' }, sim: { fixedCents: 200, ratePpm: 30_000, interestPpm: credit ? 10_000 : 0 } });
function fixture() {
  const global = emptyPolicy();
  for (const method of METHODS) for (const channel of CHANNELS) for (let n = 1; n <= (method === 'CREDIT_CARD' ? 12 : 1); n++) global.lanes[laneKey('DOM', method, channel, n)] = lane(method === 'CREDIT_CARD');
  return resolvePolicy(global, emptyPolicy(), '1:0');
}
const key = laneKey('DOM', 'CREDIT_CARD', 'ONLINE', 2);

describe('precise three-layer financial policy', () => {
  test('every modality/channel and installment agrees with actual charge adapter', () => {
    const policy = fixture();
    for (const method of METHODS) for (const channel of CHANNELS) for (let n = 1; n <= (method === 'CREDIT_CARD' ? 12 : 1); n++) {
      const result = calculateFinancials(policy, laneKey('DOM', method, channel, n), 10_001);
      const quote = quoteFinancialCharge({ policy, acquirer: 'DOM' }, 100.01, method, n, channel)!;
      expect(Math.round(quote.totalAmount * 100)).toBe(result.buyerTotalCents);
      expect(Math.round(quote.netAmount * 100)).toBe(result.netCents);
      expect(result.netCents + result.contractedCostCents).toBe(result.buyerTotalCents);
      expect(result.simMarginCents).toBe(result.contractedCostCents - result.acquirerCostCents);
      expect(result.installmentCents * (n - 1) + result.lastInstallmentCents).toBe(result.buyerTotalCents);
    }
  });
  test('zero, lower, equal and higher owner additions remain independent of contracted charges', () => {
    const policy = fixture();
    for (const addition of [0, 100, 815, 2000]) {
      policy.document.owner[key] = { ...defaultOwner(), fixedCents: addition };
      const r = calculateFinancials(policy, key, 10_000);
      expect(r.contractedCostCents).toBe(1315);
      expect(r.buyerTotalCents).toBe(10000 + addition);
      expect(r.differenceCents).toBe(addition - 1315);
      expect(r.acquirerCostCents).toBe(715);
      expect(r.simMarginCents).toBe(600);
    }
  });
  test('default owner absorbs all costs without increasing buyer total', () => {
    const policy = fixture();
    for (const method of METHODS) {
      const key = laneKey('DOM', method, 'ONLINE', 1);
      const result = calculateFinancials(policy, key, 10000);
      expect(result.buyerTotalCents).toBe(10000);
      expect(result.buyerInterestCents).toBe(0);
      expect(result.netCents).toBe(10000 - result.contractedCostCents);
      policy.document.owner[key] = defaultOwner();
    }
    expect(() => validatePolicy(policy.document)).not.toThrow();
  });
  test('9% SimIntPay cost remains seller cost, never buyer interest', () => {
    const policy = fixture();
    const key = laneKey('DOM', 'CREDIT_CARD', 'ONLINE', 1);
    policy.document.lanes[key] = { active: true, contract: { fixedCents: 0, ratePpm: 0, cashbackCents: 0, interestPpm: 0, base: 'ORIGINAL', reference: '1x' }, sim: { fixedCents: 0, ratePpm: 90000, interestPpm: 0 } };
    const result = calculateFinancials(policy, key, 10000);
    expect(result.buyerInterestCents).toBe(0);
    expect(result.buyerTotalCents).toBe(10000);
    expect(result.simAdditionCents).toBe(900);
    expect(result.netCents).toBe(9100);
  });
  test('full/partial/zero interest never waives contracted interest', () => {
    const policy = fixture();
    for (const passInterestPpm of [1_000_000, 500_000, 0]) {
      policy.document.owner[key] = { ...defaultOwner(), passInterestPpm };
      const r = calculateFinancials(policy, key, 10_000);
      expect(r.buyerInterestCents).toBe(500 * passInterestPpm / 1_000_000);
      expect(r.contractedCostCents).toBe(1315);
    }
    policy.document.interestFree = true;
    expect(calculateFinancials(policy, key, 10_000).buyerInterestCents).toBe(0);
    expect(calculateFinancials(policy, key, 10_000).contractedCostCents).toBe(1315);
  });
  test('contractual total basis, cashback, fixed costs and half-up rounding', () => {
    const policy = fixture();
    policy.document.lanes[key].contract.base = 'BUYER_TOTAL';
    expect(calculateFinancials(policy, key, 10_000).acquirerProcessingCents).toBe(315);
    policy.document.lanes[key].contract.ratePpm = 5000;
    expect(calculateFinancials(policy, key, 100).acquirerProcessingCents).toBe(116);
  });
  test('explicit zeros override global; absent values inherit with origins', () => {
    const global = fixture().document, own = emptyPolicy();
    global.owner[key] = { fixedCents: 500, ratePpm: 10_000, passInterestPpm: 1_000_000 };
    own.owner[key] = { fixedCents: 0, ratePpm: 0, passInterestPpm: 0 };
    const zero = resolvePolicy(global, own, '2:1');
    expect(zero.document.owner[key].fixedCents).toBe(0);
    expect(zero.sources[key].owner).toBe('override');
    delete own.owner[key];
    const inherited = resolvePolicy(global, own, '2:2');
    expect(inherited.document.owner[key].fixedCents).toBe(500);
    expect(inherited.sources[key].owner).toBe('global');
  });
  test('owner projection contains no acquirer composition or SimIntPay margin', () => {
    const projection = ownerResult(calculateFinancials(fixture(), key, 10_000));
    for (const key of ['domFeeAmount', 'acquirerCostCents', 'acquirerInterestCents', 'simAdditionCents', 'simInterestCents', 'simMarginCents']) expect(projection).not.toHaveProperty(key);
  });
  test('invalid amounts, malformed or incomplete contracts cannot activate', () => {
    const policy = fixture();
    for (const value of [0, -1, Infinity, 1.5, 1_000_000_001]) expect(() => calculateFinancials(policy, key, value)).toThrow();
    delete (policy.document.lanes[key].contract as Partial<Lane['contract']>).interestPpm;
    expect(() => validatePolicy(policy.document)).toThrow();
    expect(() => validatePolicy({ ...emptyPolicy(), owner: { 'DOM/PIX/ONLINE/12': defaultOwner() } })).toThrow();
  });
});


describe('interest-only pricing and frozen history', () => {
  test('new charges only pass real interest and restore without adopting historical additions', async () => {
    const policy = fixture();
    policy.document.owner[key] = { fixedCents: 1000, ratePpm: 100000, passInterestPpm: 500000 };
    const document = structuredClone(policy.document);
    const historical = quoteFinancialCharge({ policy, acquirer: 'DOM', tag: 'SHOP' }, 100, 'CREDIT_CARD', 2)!;
    policy.document.interestOnly = true;
    const current = quoteFinancialCharge({ policy, acquirer: 'DOM', tag: 'SHOP' }, 100, 'CREDIT_CARD', 2)!;
    expect(current.totalAmount).toBe(102.5);
    expect(current.netAmount).toBe(89.35);
    expect(current.financialSnapshot.buyerAdditionCents).toBe(0);
    expect(current.financialSnapshot.interestOnly).toBe(true);
    const prisma = { financialPolicyRevision: { findMany: async () => [{ tag: 'GLOBAL', version: 1, document }] } } as any;
    expect((await restoreFinancialCharge(prisma, historical.financialSnapshot))?.totalAmount).toBe(122.5);
    expect((await restoreFinancialCharge(prisma, current.financialSnapshot))?.totalAmount).toBe(102.5);
    expect(document.interestOnly).toBe(false);
  });

  test('interest-free suppresses only buyer interest, and invalid fractions cannot mark up costs', () => {
    const policy = fixture();
    policy.document.interestOnly = true;
    policy.document.owner[key] = { fixedCents: 5000, ratePpm: 1000000, passInterestPpm: 1000000 };
    expect(calculateFinancials(policy, key, 10000).buyerTotalCents).toBe(10500);
    policy.document.interestFree = true;
    const result = calculateFinancials(policy, key, 10000);
    expect(result.buyerTotalCents).toBe(10000);
    expect(result.netCents).toBe(8685);
    policy.document.owner[key].passInterestPpm = 1000001;
    expect(() => validatePolicy(policy.document)).toThrow();
  });
});


describe('installment interest separated from processing fees', () => {
  test('full, partial and zero interest pass-through never enter processing difference', () => {
    const policy = fixture();
    policy.document.interestOnly = true;
    policy.document.owner[key] = { ...defaultOwner(), passInterestPpm: 1_000_000 };
    const full = calculateFinancials(policy, key, 10000);
    expect(full.buyerTotalCents).toBe(10500);
    expect(full.interestRatePpm).toBe(50000);
    expect(full.buyerInterestRatePpm).toBe(50000);
    expect(full.processingCostCents).toBe(815);
    expect(full.interestCostCents).toBe(500);
    expect(full.differenceCents).toBe(-815);
    for (const passInterestPpm of [0, 500000, 1000000]) {
      policy.document.owner[key] = { ...defaultOwner(), passInterestPpm };
      const result = calculateFinancials(policy, key, 10000);
      expect(result.buyerInterestCents).toBe(500 * passInterestPpm / 1000000);
      expect(result.buyerInterestRatePpm).toBe(50000 * passInterestPpm / 1000000);
      expect(result.differenceCents).toBe(-815);
      expect(result.netCents).toBe(result.buyerTotalCents - 1315);
      expect(ownerResult(result).interestRatePpm).toBe(50000);
    }
    policy.document.interestFree = true;
    const free = calculateFinancials(policy, key, 10000);
    expect(free.buyerInterestRatePpm).toBe(0);
    expect(free.buyerTotalCents).toBe(10000);
    expect(free.differenceCents).toBe(-815);
    expect(free.netCents).toBe(8685);
  });
});
