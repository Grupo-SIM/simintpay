import { expect, test } from 'bun:test';
import {
  deliveryAllocation,
  quoteDeliveryCharge,
} from './delivery-payment-allocation';

test('requires explicit safe cent allocation only for Delivery', () => {
  for (const allocation of [
    undefined,
    null,
    {},
    { merchantAmountCents: -1, platformFeeCents: 1 },
    { merchantAmountCents: 100, platformFeeCents: 0.5 },
    { merchantAmountCents: '100', platformFeeCents: 5 },
    { merchantAmountCents: Number.MAX_SAFE_INTEGER + 1, platformFeeCents: 0 },
  ]) {
    expect(() =>
      deliveryAllocation('sim-delivery_zero-grau', allocation as never),
    ).toThrow();
  }
  expect(deliveryAllocation('other')).toBeUndefined();
  expect(() =>
    deliveryAllocation('other', {
      merchantAmountCents: 100,
      platformFeeCents: 5,
    }),
  ).toThrow();
});

test('preserves final total and exact merchant proceeds including zero-fee and zero-merchant charges', () => {
  for (const allocation of [
    { merchantAmountCents: 10000, platformFeeCents: 537 },
    { merchantAmountCents: 29, platformFeeCents: 0 },
    { merchantAmountCents: 0, platformFeeCents: 100 },
  ]) {
    const total = allocation.merchantAmountCents + allocation.platformFeeCents;
    expect(
      quoteDeliveryCharge(total / 100, allocation, 'ADDITIVE_ONLY'),
    ).toMatchObject({
      totalAmount: total / 100,
      netAmount: allocation.merchantAmountCents / 100,
      totalFeeAmount: allocation.platformFeeCents / 100,
      domFeeAmount: 0,
      financialSnapshot: {
        contract: 'SIM_DELIVERY_ALLOCATION_V1',
        totalAmountCents: total,
        feeMode: 'ADDITIVE_ONLY',
        simFeeCents: 0,
        ...allocation,
      },
    });
  }
});

test('rejects mismatched totals, fractional cents and empty charges', () => {
  for (const price of [104.99, 105.001, 106, 0, -105]) {
    expect(() =>
      quoteDeliveryCharge(
        price,
        { merchantAmountCents: 10000, platformFeeCents: 500 },
        'ADDITIVE_ONLY',
      ),
    ).toThrow();
  }
  expect(() =>
    quoteDeliveryCharge(
      0,
      { merchantAmountCents: 0, platformFeeCents: 0 },
      'ADDITIVE_ONLY',
    ),
  ).toThrow();
});

test('additive-only keeps the merchant share untouched and ignores SimIntPay fees', () => {
  const quote = quoteDeliveryCharge(
    105,
    { merchantAmountCents: 10000, platformFeeCents: 500 },
    'ADDITIVE_ONLY',
    { fixedCents: 99, ratePpm: 50000 },
  );
  expect(quote).toMatchObject({
    totalAmount: 105,
    netAmount: 100,
    totalFeeAmount: 5,
    simFeeAmount: 0,
  });
  expect(quote.financialSnapshot).toMatchObject({
    feeMode: 'ADDITIVE_ONLY',
    simFeeCents: 0,
  });
});

test('SimIntPay-only deducts the sim fee from the merchant', () => {
  const sim = { fixedCents: 100, ratePpm: 20000 };
  const quote = quoteDeliveryCharge(
    100,
    { merchantAmountCents: 10000, platformFeeCents: 0 },
    'SIMINTPAY_ONLY',
    sim,
  );
  // 1.00 fixed + 2% of the 100.00 buyer total
  expect(quote).toMatchObject({
    totalAmount: 100,
    netAmount: 97,
    totalFeeAmount: 3,
    simFeeAmount: 3,
  });
  expect(() =>
    quoteDeliveryCharge(
      100,
      { merchantAmountCents: 10000, platformFeeCents: 0 },
      'SIMINTPAY_ONLY',
    ),
  ).toThrow();
});

test('a surcharge sent under SIMINTPAY_ONLY means the mode changed and is rejected', () => {
  expect(() =>
    quoteDeliveryCharge(
      105,
      { merchantAmountCents: 10000, platformFeeCents: 500 },
      'SIMINTPAY_ONLY',
      { fixedCents: 0, ratePpm: 0 },
    ),
  ).toThrow('O modo de taxas da plataforma mudou');
});

test('both applies the surcharge and the sim fee on the buyer total', () => {
  const quote = quoteDeliveryCharge(
    105,
    { merchantAmountCents: 10000, platformFeeCents: 500 },
    'BOTH',
    { fixedCents: 0, ratePpm: 20000 },
  );
  // 2% of 105.00 = 2.10 comes out of the merchant's 100.00
  expect(quote).toMatchObject({
    totalAmount: 105,
    netAmount: 97.9,
    totalFeeAmount: 7.1,
    simFeeAmount: 2.1,
  });
});

test('rejects a sim fee larger than the merchant share', () => {
  expect(() =>
    quoteDeliveryCharge(
      1,
      { merchantAmountCents: 100, platformFeeCents: 0 },
      'BOTH',
      { fixedCents: 500, ratePpm: 0 },
    ),
  ).toThrow();
});

test('recomputes the additive surcharge from order items and rejects a mismatch with FEE_MISMATCH', () => {
  const surcharges = [
    {
      id: 'f',
      name: 'Serviço',
      applicationScope: 'order' as const,
      percentageValue: 1_000,
      fixedValue: 0,
    },
  ];
  const items = [{ key: 'a', quantity: 2, unitPriceCents: 5_000 }];
  // 10% of 10000 = 1000
  const ok = {
    items,
    merchantAmountCents: 10_000,
    platformFeeCents: 1_000,
  };
  expect(
    quoteDeliveryCharge(110, ok, 'ADDITIVE_ONLY', undefined, surcharges),
  ).toMatchObject({ totalAmount: 110, netAmount: 100 });
  try {
    quoteDeliveryCharge(
      109,
      { ...ok, platformFeeCents: 900 },
      'ADDITIVE_ONLY',
      undefined,
      surcharges,
    );
    throw new Error('expected FEE_MISMATCH');
  } catch (error) {
    expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({
      code: 'FEE_MISMATCH',
      expectedPlatformFeeCents: 1_000,
    });
  }
  // No associated fees: any surcharge sent with items is a mismatch.
  expect(() => quoteDeliveryCharge(110, ok, 'ADDITIVE_ONLY')).toThrow();
});

test('keeps trusting platformFeeCents when items are absent', () => {
  expect(
    quoteDeliveryCharge(
      110,
      { merchantAmountCents: 10_000, platformFeeCents: 1_000 },
      'ADDITIVE_ONLY',
    ),
  ).toMatchObject({ totalAmount: 110 });
});
