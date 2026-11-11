import { expect, test } from 'bun:test';
import {
  deliveryAllocation,
  quoteAllocationCharge,
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
    expect(quoteAllocationCharge(total / 100, allocation)).toMatchObject({
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
      quoteAllocationCharge(price, {
        merchantAmountCents: 10000,
        platformFeeCents: 500,
      }),
    ).toThrow();
  }
  expect(() =>
    quoteAllocationCharge(0, { merchantAmountCents: 0, platformFeeCents: 0 }),
  ).toThrow();
});

test('keeps the merchant share untouched: no SimIntPay fee is deducted', () => {
  const quote = quoteAllocationCharge(105, {
    merchantAmountCents: 10000,
    platformFeeCents: 500,
  });
  expect(quote).toMatchObject({
    totalAmount: 105,
    netAmount: 100,
    totalFeeAmount: 5,
    domFeeAmount: 0,
  });
  expect(quote.financialSnapshot).not.toHaveProperty('simFeeCents');
  expect(quote.financialSnapshot).not.toHaveProperty('feeMode');
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
  expect(quoteAllocationCharge(110, ok, surcharges)).toMatchObject({
    totalAmount: 110,
    netAmount: 100,
  });
  try {
    quoteAllocationCharge(109, { ...ok, platformFeeCents: 900 }, surcharges);
    throw new Error('expected FEE_MISMATCH');
  } catch (error) {
    expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({
      code: 'FEE_MISMATCH',
      expectedPlatformFeeCents: 1_000,
    });
  }
  // No associated fees: any surcharge sent with items is a mismatch.
  expect(() => quoteAllocationCharge(110, ok)).toThrow();
});

test('keeps trusting platformFeeCents when items are absent', () => {
  expect(
    quoteAllocationCharge(110, {
      merchantAmountCents: 10_000,
      platformFeeCents: 1_000,
    }),
  ).toMatchObject({ totalAmount: 110 });
});
