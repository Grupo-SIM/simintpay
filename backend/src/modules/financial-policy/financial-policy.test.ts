import { describe, expect, test } from 'bun:test';
import {
  calculateFinancials,
  CHANNELS,
  defaultOwner,
  emptyPolicy,
  laneKey,
  METHODS,
  ownerResult,
  resolvePolicy,
  validatePolicy,
  type Lane,
} from './financial-policy';
import {
  quoteFinancialCharge,
  restoreFinancialCharge,
} from './financial-charge';
import type { AcquirerCost } from './acquirer-fees';

const lane = (credit = true): Lane => ({
  active: true,
  contract: {
    fixedCents: 100,
    ratePpm: 20_000,
    cashbackCents: 15,
    interestPpm: credit ? 40_000 : 0,
    base: 'ORIGINAL',
    reference: 'Signed 2026-10',
  },
  sim: { fixedCents: 200, ratePpm: 30_000, interestPpm: credit ? 10_000 : 0 },
});
function fixture() {
  const global = emptyPolicy();
  for (const method of METHODS)
    for (const channel of CHANNELS)
      for (let n = 1; n <= (method === 'CREDIT_CARD' ? 12 : 1); n++)
        global.lanes[laneKey('DOM', method, channel, n)] = lane(
          method === 'CREDIT_CARD',
        );
  return resolvePolicy(global, emptyPolicy(), '1:0');
}
const key = laneKey('DOM', 'CREDIT_CARD', 'ONLINE', 2);

describe('scheduled acquirer quotes and immutable floors', () => {
  const date = new Date('2026-10-01T00:00:00.000Z');
  const dom: AcquirerCost = {
    acquirer: 'DOM',
    fixedCents: 100,
    ratePpm: 20_000,
    interestPpm: 40_000,
    base: 'ORIGINAL',
    source: 'API',
    createdAt: date,
  };
  const other: AcquirerCost = {
    ...dom,
    acquirer: 'OTHER',
    fixedCents: 300,
    ratePpm: 40_000,
    interestPpm: 70_000,
  };
  const scheduled = (fee: AcquirerCost) => ({
    ...fee,
    createdAt: fee.createdAt.toISOString(),
  });

  test('max active fee sets buyer price, routed cost sets settlement and snapshot', () => {
    const policy = fixture();
    policy.document.owner[key] = {
      ...defaultOwner(),
      passInterestPpm: 1_000_000,
    };
    const feesByLane = { 'CREDIT_CARD/ONLINE/2': [dom, other] };
    const quote = quoteFinancialCharge(
      { policy, acquirer: 'DOM', feesByLane },
      100,
      'CREDIT_CARD',
      2,
    )!;
    const result = calculateFinancials(policy, key, 10_000, undefined, {
      fees: [scheduled(dom), scheduled(other)],
      routedAcquirer: 'DOM',
    });
    expect('pricingAcquirer' in result && result.pricingAcquirer).toBe('OTHER');
    expect('realizedAcquirer' in result && result.realizedAcquirer).toBe('DOM');
    expect('fallbackPricing' in result && result.fallbackPricing).toBe(true);
    expect(result.buyerAdditionCents).toBe(1_200);
    expect(result.buyerInterestCents).toBe(800);
    expect(result.buyerTotalCents).toBe(12_000);
    expect(result.contractedCostCents).toBe(2_000);
    expect(result.acquirerCostCents).toBe(700);
    expect(result.netCents).toBe(10_000);
    expect(result.simMarginCents).toBe(1_300);
    expect(
      'acquirerCost' in quote.financialSnapshot
        ? quote.financialSnapshot.acquirerCost?.realizedCents
        : undefined,
    ).toBe(700);
    expect(quote.domFeeAmount).toBe(7);
    expect(quote.totalFeeAmount).toBe(20);
  });

  test('a historical price floor does not combine its fee with a rising current fee', () => {
    const policy = fixture();
    policy.document.lanes[key]!.priceFloor = {
      fees: [scheduled(other)],
      sim: { fixedCents: 200, ratePpm: 30_000, interestPpm: 10_000 },
    };
    const now = { ...dom, fixedCents: 0, ratePpm: 0, interestPpm: 100_000 };
    const floored = calculateFinancials(policy, key, 10_000, undefined, {
      fees: [scheduled(now)],
      routedAcquirer: 'DOM',
    });
    const historical = calculateFinancials(policy, key, 10_000, undefined, {
      fees: [scheduled(other)],
      routedAcquirer: 'OTHER',
    });
    expect(floored.buyerTotalCents).toBeGreaterThanOrEqual(
      historical.buyerTotalCents,
    );
    expect(floored.contractedCostCents).toBe(historical.contractedCostCents);
    expect(floored.netCents).toBe(historical.netCents);
  });

  test('buyer price and canonical lane remain unchanged when processor route changes', () => {
    const policy = fixture();
    const otherKey = laneKey('OTHER', 'CREDIT_CARD', 'ONLINE', 2);
    policy.document.lanes[otherKey] = {
      ...lane(),
      sim: { fixedCents: 9_000, ratePpm: 80_000, interestPpm: 70_000 },
    };
    policy.document.owner[key] = {
      ...defaultOwner(),
      passInterestPpm: 1_000_000,
    };
    policy.document.owner[otherKey] = { ...defaultOwner(), fixedCents: 1_000 };
    const feesByLane = { 'CREDIT_CARD/ONLINE/2': [dom, other] };
    const domQuote = quoteFinancialCharge(
      { policy, acquirer: 'DOM', feesByLane },
      100,
      'CREDIT_CARD',
      2,
    )!;
    const otherQuote = quoteFinancialCharge(
      { policy, acquirer: 'OTHER', feesByLane },
      100,
      'CREDIT_CARD',
      2,
    )!;
    expect(domQuote.totalAmount).toBe(otherQuote.totalAmount);
    expect(domQuote.netAmount).toBe(otherQuote.netAmount);
    expect(domQuote.financialSnapshot.key).toBe(key);
    expect(otherQuote.financialSnapshot.key).toBe(key);
    expect(domQuote.domFeeAmount).not.toBe(otherQuote.domFeeAmount);
    expect(
      'acquirerCost' in domQuote.financialSnapshot
        ? domQuote.financialSnapshot.acquirerCost?.acquirer
        : undefined,
    ).toBe('DOM');
    expect(
      'acquirerCost' in otherQuote.financialSnapshot
        ? otherQuote.financialSnapshot.acquirerCost?.acquirer
        : undefined,
    ).toBe('OTHER');
  });

  test('missing negotiated schedules charge twice the internal excess without claiming realized acquirer cost', () => {
    const policy = fixture();
    policy.document.owner[key] = {
      ...defaultOwner(),
      passInterestPpm: 1_000_000,
    };
    const quote = quoteFinancialCharge(
      { policy, acquirer: 'DOM', feesByLane: {} },
      100,
      'CREDIT_CARD',
      2,
    )!;
    expect(quote.financialSnapshot.fallbackPricing).toBe(true);
    expect(
      'acquirerCost' in quote.financialSnapshot
        ? quote.financialSnapshot.acquirerCost
        : undefined,
    ).toEqual({ acquirer: 'DOM', source: 'UNCONFIGURED', realizedCents: null });
    expect(quote.totalFeeAmount).toBe(12);
    expect(quote.totalAmount).toBe(112);
    expect(quote.netAmount).toBe(100);
    expect(quote.platformProfit).toBe(0);
  });

  test('restores an unknown-cost fallback snapshot without manufacturing acquirer cost or profit', async () => {
    const policy = fixture();
    const quote = quoteFinancialCharge(
      { policy, acquirer: 'DOM', tag: 'SHOP', feesByLane: {} },
      100,
      'CREDIT_CARD',
      2,
    )!;
    const snapshot = JSON.parse(JSON.stringify(quote.financialSnapshot));
    const prisma = {
      financialPolicyRevision: { findMany: async () => [] },
    } as any;
    const restored = await restoreFinancialCharge(prisma, snapshot);
    expect(restored?.financialSnapshot).toEqual(snapshot);
    expect(restored?.totalAmount).toBe(quote.totalAmount);
    expect(restored?.netAmount).toBe(quote.netAmount);
    expect(restored?.totalFeeAmount).toBe(quote.totalFeeAmount);
    for (const field of [
      'domFeeAmount',
      'sellerFee',
      'platformFeeAmount',
      'platformProfit',
    ])
      expect(restored).not.toHaveProperty(field);
    await expect(
      restoreFinancialCharge(prisma, {
        ...snapshot,
        acquirerCost: { acquirer: 'DOM', source: 'API', realizedCents: null },
      }),
    ).rejects.toThrow('Snapshot financeiro inválido');
  });

  test('restores a scheduled snapshot with its original realized cost', async () => {
    const policy = fixture();
    const quote = quoteFinancialCharge(
      {
        policy,
        acquirer: 'DOM',
        tag: 'SHOP',
        feesByLane: { 'CREDIT_CARD/ONLINE/2': [dom] },
      },
      100,
      'CREDIT_CARD',
      2,
    )!;
    const snapshot = JSON.parse(JSON.stringify(quote.financialSnapshot));
    const prisma = {
      financialPolicyRevision: { findMany: async () => [] },
    } as any;
    const restored = await restoreFinancialCharge(prisma, snapshot);
    expect(restored?.financialSnapshot).toEqual(snapshot);
    expect(restored?.totalAmount).toBe(quote.totalAmount);
    expect(restored?.netAmount).toBe(quote.netAmount);
    expect(restored?.domFeeAmount).toBe(quote.domFeeAmount);
    expect(restored?.platformProfit).toBe(quote.platformProfit);
  });

  test('no-schedule fallback chooses the same configured lane for every route', () => {
    const policy = fixture();
    const otherKey = laneKey('OTHER', 'CREDIT_CARD', 'ONLINE', 2);
    policy.document.lanes[otherKey] = {
      ...lane(),
      sim: { fixedCents: 9_000, ratePpm: 0, interestPpm: 0 },
    };
    const domQuote = quoteFinancialCharge(
      { policy, acquirer: 'DOM', feesByLane: {} },
      100,
      'CREDIT_CARD',
      2,
    )!;
    const otherQuote = quoteFinancialCharge(
      { policy, acquirer: 'OTHER', feesByLane: {} },
      100,
      'CREDIT_CARD',
      2,
    )!;
    expect(domQuote.totalAmount).toBe(otherQuote.totalAmount);
    expect(domQuote.financialSnapshot.key).toBe(key);
    delete policy.document.lanes[key];
    expect(
      quoteFinancialCharge(
        { policy, acquirer: 'DOM', feesByLane: {} },
        100,
        'CREDIT_CARD',
        2,
      )?.financialSnapshot.key,
    ).toBe(otherKey);
  });

  test('PIX buyer pays processing while owner absorbs no duplicate interest', () => {
    const policy = fixture();
    const pix = laneKey('DOM', 'PIX', 'ONLINE', 1);
    const fees = [{ ...dom, interestPpm: 0 }];
    const result = calculateFinancials(policy, pix, 10_000, undefined, {
      fees: fees.map(scheduled),
      routedAcquirer: 'DOM',
    });
    expect(result.buyerTotalCents).toBe(10_800);
    expect(result.buyerInterestCents).toBe(0);
    expect(result.netCents).toBe(10_000);
    expect(result.simMarginCents).toBe(500);
  });

  test('fee decrease preserves price through stored floor at any amount', () => {
    const policy = fixture();
    policy.document.lanes[key]!.priceFloor = {
      fees: [scheduled(dom), scheduled(other)],
      sim: { ...policy.document.lanes[key]!.sim },
    };
    const lowered = { ...dom, fixedCents: 0, ratePpm: 0, interestPpm: 0 };
    const currentOther = {
      ...other,
      fixedCents: 0,
      ratePpm: 0,
      interestPpm: 0,
    };
    for (const amount of [99, 10_000, 500_000]) {
      const result = calculateFinancials(policy, key, amount, undefined, {
        fees: [scheduled(lowered), scheduled(currentOther)],
        routedAcquirer: 'DOM',
      });
      const previous = calculateFinancials(
        {
          ...policy,
          document: {
            ...policy.document,
            lanes: {
              ...policy.document.lanes,
              [key]: { ...policy.document.lanes[key]!, priceFloor: undefined },
            },
          },
        },
        key,
        amount,
        undefined,
        { fees: [scheduled(dom), scheduled(other)], routedAcquirer: 'DOM' },
      );
      expect(result.buyerTotalCents).toBe(previous.buyerTotalCents);
      expect(result.contractedCostCents).toBe(previous.contractedCostCents);
      expect(result.simMarginCents).toBe(
        result.contractedCostCents - result.acquirerCostCents,
      );
    }
  });
});

describe('precise three-layer financial policy', () => {
  test('every modality/channel and installment agrees with actual charge adapter', () => {
    const policy = fixture();
    for (const method of METHODS)
      for (const channel of CHANNELS)
        for (let n = 1; n <= (method === 'CREDIT_CARD' ? 12 : 1); n++) {
          const result = calculateFinancials(
            policy,
            laneKey('DOM', method, channel, n),
            10_001,
          );
          const quote = quoteFinancialCharge(
            { policy, acquirer: 'DOM' },
            100.01,
            method,
            n,
            channel,
          )!;
          expect(Math.round(quote.totalAmount * 100)).toBe(
            result.buyerTotalCents,
          );
          expect(Math.round(quote.netAmount * 100)).toBe(result.netCents);
          expect(result.netCents + result.contractedCostCents).toBe(
            result.buyerTotalCents,
          );
          expect(result.simMarginCents).toBe(
            result.contractedCostCents - result.acquirerCostCents,
          );
          expect(
            result.installmentCents * (n - 1) + result.lastInstallmentCents,
          ).toBe(result.buyerTotalCents);
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
    policy.document.lanes[key] = {
      active: true,
      contract: {
        fixedCents: 0,
        ratePpm: 0,
        cashbackCents: 0,
        interestPpm: 0,
        base: 'ORIGINAL',
        reference: '1x',
      },
      sim: { fixedCents: 0, ratePpm: 90000, interestPpm: 0 },
    };
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
      expect(r.buyerInterestCents).toBe((500 * passInterestPpm) / 1_000_000);
      expect(r.contractedCostCents).toBe(1315);
    }
    policy.document.interestFree = true;
    expect(calculateFinancials(policy, key, 10_000).buyerInterestCents).toBe(0);
    expect(calculateFinancials(policy, key, 10_000).contractedCostCents).toBe(
      1315,
    );
  });
  test('contractual total basis, cashback, fixed costs and half-up rounding', () => {
    const policy = fixture();
    policy.document.lanes[key].contract.base = 'BUYER_TOTAL';
    expect(
      calculateFinancials(policy, key, 10_000).acquirerProcessingCents,
    ).toBe(315);
    policy.document.lanes[key].contract.ratePpm = 5000;
    expect(calculateFinancials(policy, key, 100).acquirerProcessingCents).toBe(
      116,
    );
  });
  test('explicit zeros override global; absent values inherit with origins', () => {
    const global = fixture().document,
      own = emptyPolicy();
    global.owner[key] = {
      fixedCents: 500,
      ratePpm: 10_000,
      passInterestPpm: 1_000_000,
    };
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
    for (const key of [
      'domFeeAmount',
      'acquirerCostCents',
      'acquirerInterestCents',
      'simAdditionCents',
      'simInterestCents',
      'simMarginCents',
    ])
      expect(projection).not.toHaveProperty(key);
  });
  test('invalid amounts, malformed or incomplete contracts cannot activate', () => {
    const policy = fixture();
    for (const value of [0, -1, Infinity, 1.5, 1_000_000_001])
      expect(() => calculateFinancials(policy, key, value)).toThrow();
    delete (policy.document.lanes[key].contract as Partial<Lane['contract']>)
      .interestPpm;
    expect(() => validatePolicy(policy.document)).toThrow();
    expect(() =>
      validatePolicy({
        ...emptyPolicy(),
        owner: { 'DOM/PIX/ONLINE/12': defaultOwner() },
      }),
    ).toThrow();
  });
});

describe('interest-only pricing and frozen history', () => {
  test('new charges only pass real interest and restore without adopting historical additions', async () => {
    const policy = fixture();
    policy.document.owner[key] = {
      fixedCents: 1000,
      ratePpm: 100000,
      passInterestPpm: 500000,
    };
    const document = structuredClone(policy.document);
    const historical = quoteFinancialCharge(
      { policy, acquirer: 'DOM', tag: 'SHOP' },
      100,
      'CREDIT_CARD',
      2,
    )!;
    policy.document.interestOnly = true;
    const current = quoteFinancialCharge(
      { policy, acquirer: 'DOM', tag: 'SHOP' },
      100,
      'CREDIT_CARD',
      2,
    )!;
    expect(current.totalAmount).toBe(102.5);
    expect(current.netAmount).toBe(89.35);
    expect(current.financialSnapshot.buyerAdditionCents).toBe(0);
    expect(current.financialSnapshot.interestOnly).toBe(true);
    const prisma = {
      financialPolicyRevision: {
        findMany: async () => [{ tag: 'GLOBAL', version: 1, document }],
      },
    } as any;
    expect(
      (await restoreFinancialCharge(prisma, historical.financialSnapshot))
        ?.totalAmount,
    ).toBe(122.5);
    expect(
      (await restoreFinancialCharge(prisma, current.financialSnapshot))
        ?.totalAmount,
    ).toBe(102.5);
    expect(document.interestOnly).toBe(false);
  });

  test('interest-free suppresses only buyer interest, and invalid fractions cannot mark up costs', () => {
    const policy = fixture();
    policy.document.interestOnly = true;
    policy.document.owner[key] = {
      fixedCents: 5000,
      ratePpm: 1000000,
      passInterestPpm: 1000000,
    };
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
    policy.document.owner[key] = {
      ...defaultOwner(),
      passInterestPpm: 1_000_000,
    };
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
      expect(result.buyerInterestCents).toBe((500 * passInterestPpm) / 1000000);
      expect(result.buyerInterestRatePpm).toBe(
        (50000 * passInterestPpm) / 1000000,
      );
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
