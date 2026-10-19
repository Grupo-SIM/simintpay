import { describe, expect, test } from 'bun:test';
import { calculateFinancials, CHANNELS, defaultOwner, emptyPolicy, laneKey, METHODS, ownerResult, resolvePolicy, validatePolicy, type Lane } from './financial-policy';
import { quoteFinancialCharge } from './financial-charge';

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
      expect(r.buyerTotalCents).toBe(10500 + addition);
      expect(r.differenceCents).toBe(addition - 815);
      expect(r.acquirerCostCents).toBe(715);
      expect(r.simMarginCents).toBe(600);
    }
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
    expect(calculateFinancials(policy, key, 10_000).acquirerProcessingCents).toBe(325);
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
