import { describe, expect, it } from 'bun:test';
import {
  calculatePlatformFees,
  evaluateCoverage,
  hasShortfall,
  surchargeComponents,
  type EffectiveFee,
} from './additive-fee-calculation';

const fee = (over: Partial<EffectiveFee>): EffectiveFee => ({
  id: 'f',
  name: 'Taxa',
  applicationScope: 'order',
  percentageValue: 0,
  fixedValue: 0,
  ...over,
});

describe('calculatePlatformFees', () => {
  const items = [
    { key: 'a', quantity: 2, unitPrice: 1_050 },
    { key: 'b', quantity: 1, unitPrice: 333 },
  ];

  it('applies order-scoped fees once on the subtotal with half-up rounding', () => {
    const result = calculatePlatformFees(
      [fee({ percentageValue: 250, fixedValue: 99 })],
      items,
    );
    // subtotal 2433 * 2.5% = 60.825 -> 61, + 99
    expect(result.feeTotalCents).toBe(160);
    expect(result.fees[0]!.items).toEqual([]);
  });

  it('applies product-scoped fees per unit and multiplies by quantity', () => {
    const result = calculatePlatformFees(
      [
        fee({
          applicationScope: 'product',
          percentageValue: 100,
          fixedValue: 10,
        }),
      ],
      items,
    );
    // 1050 * 1% = 10.5 -> 11 (+10) = 21 x2; 333 * 1% = 3.33 -> 3 (+10) = 13
    expect(result.fees[0]!.items).toEqual([
      { itemKey: 'a', unitAmountCents: 21, amountCents: 42 },
      { itemKey: 'b', unitAmountCents: 13, amountCents: 13 },
    ]);
    expect(result.feeTotalCents).toBe(55);
  });

  it('sums stacked fees without compounding', () => {
    const result = calculatePlatformFees(
      [fee({ percentageValue: 100 }), fee({ id: 'g', fixedValue: 5 })],
      [{ key: 'a', quantity: 1, unitPrice: 10_000 }],
    );
    expect(result.feeTotalCents).toBe(105);
  });
});

describe('coverage per mode', () => {
  const lane = { method: 'PIX', installments: 1 };
  const costs = [{ ...lane, ratePpm: 9_800, fixedCents: 100 }];
  const simintpay = [{ ...lane, ratePpm: 5_000, fixedCents: 50 }];
  const surcharges = surchargeComponents([
    fee({ percentageValue: 50, fixedValue: 50 }),
  ]);

  it('converts basis points to ppm and sums fixed cents', () => {
    expect(
      surchargeComponents([
        fee({ percentageValue: 50, fixedValue: 7 }),
        fee({ percentageValue: 25, fixedValue: 3 }),
      ]),
    ).toEqual({ ratePpm: 7_500, fixedCents: 10 });
  });

  it('SIMINTPAY_ONLY ignores additive fees', () => {
    const [result] = evaluateCoverage({
      costs,
      simintpay,
      surcharges,
      mode: 'SIMINTPAY_ONLY',
    });
    expect(result!.covered).toEqual({ ratePpm: 5_000, fixedCents: 50 });
    expect(result).toMatchObject({
      rateShortfallPpm: 4_800,
      fixedShortfallCents: 50,
    });
  });

  it('ADDITIVE_ONLY ignores the SimIntPay fee', () => {
    const [result] = evaluateCoverage({
      costs,
      simintpay,
      surcharges,
      mode: 'ADDITIVE_ONLY',
    });
    expect(result!.covered).toEqual({ ratePpm: 5_000, fixedCents: 50 });
  });

  it('BOTH sums components and can cover the cost', () => {
    const lanes = evaluateCoverage({
      costs,
      simintpay,
      surcharges,
      mode: 'BOTH',
    });
    expect(lanes[0]!.covered).toEqual({ ratePpm: 10_000, fixedCents: 100 });
    expect(hasShortfall(lanes)).toBe(false);
  });

  it('flags a shortfall when only one component falls short and skips disabled lanes', () => {
    const low = evaluateCoverage({
      costs,
      simintpay: [{ ...lane, ratePpm: 20_000, fixedCents: 0 }],
      surcharges: { ratePpm: 0, fixedCents: 0 },
      mode: 'SIMINTPAY_ONLY',
    });
    expect(hasShortfall(low)).toBe(true);
    expect(
      evaluateCoverage({
        costs,
        simintpay,
        surcharges,
        mode: 'SIMINTPAY_ONLY',
        disabledLanes: ['PIX/1'],
      }),
    ).toEqual([]);
  });
});
