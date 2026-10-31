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
    expect(quoteDeliveryCharge(total / 100, allocation)).toMatchObject({
      totalAmount: total / 100,
      netAmount: allocation.merchantAmountCents / 100,
      totalFeeAmount: allocation.platformFeeCents / 100,
      domFeeAmount: 0,
      financialSnapshot: {
        contract: 'SIM_DELIVERY_ALLOCATION_V1',
        totalAmountCents: total,
        ...allocation,
      },
    });
  }
});

test('rejects mismatched totals, fractional cents and empty charges', () => {
  for (const price of [104.99, 105.001, 106, 0, -105]) {
    expect(() =>
      quoteDeliveryCharge(price, {
        merchantAmountCents: 10000,
        platformFeeCents: 500,
      }),
    ).toThrow();
  }
  expect(() =>
    quoteDeliveryCharge(0, { merchantAmountCents: 0, platformFeeCents: 0 }),
  ).toThrow();
});

test('additive-only keeps the merchant share untouched and ignores SimIntPay fees', () => {
  const quote = quoteDeliveryCharge(
    105,
    { merchantAmountCents: 10000, platformFeeCents: 500 },
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

test('SimIntPay-only deducts the sim fee from the merchant and rejects an additive surcharge', () => {
  const sim = { fixedCents: 100, ratePpm: 20000 };
  const quote = quoteDeliveryCharge(
    100,
    {
      feeMode: 'SIMINTPAY_ONLY',
      merchantAmountCents: 10000,
      platformFeeCents: 0,
    },
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
      105,
      {
        feeMode: 'SIMINTPAY_ONLY',
        merchantAmountCents: 10000,
        platformFeeCents: 500,
      },
      sim,
    ),
  ).toThrow();
  expect(() =>
    quoteDeliveryCharge(100, {
      feeMode: 'SIMINTPAY_ONLY',
      merchantAmountCents: 10000,
      platformFeeCents: 0,
    }),
  ).toThrow();
});

test('both applies the surcharge and the sim fee on the buyer total', () => {
  const quote = quoteDeliveryCharge(
    105,
    { feeMode: 'BOTH', merchantAmountCents: 10000, platformFeeCents: 500 },
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

test('rejects a sim fee larger than the merchant share and unknown modes', () => {
  expect(() =>
    quoteDeliveryCharge(
      1,
      { feeMode: 'BOTH', merchantAmountCents: 100, platformFeeCents: 0 },
      { fixedCents: 500, ratePpm: 0 },
    ),
  ).toThrow();
  expect(() =>
    deliveryAllocation('sim-delivery_x', {
      feeMode: 'NOPE' as never,
      merchantAmountCents: 100,
      platformFeeCents: 0,
    }),
  ).toThrow();
});
