import { expect, test } from 'bun:test';
import { deliveryAllocation, quoteDeliveryCharge } from './delivery-payment-allocation';

test('requires explicit safe cent allocation only for Delivery', () => {
  for (const allocation of [undefined, null, {}, { merchantAmountCents: -1, platformFeeCents: 1 },
    { merchantAmountCents: 100, platformFeeCents: 0.5 }, { merchantAmountCents: '100', platformFeeCents: 5 },
    { merchantAmountCents: Number.MAX_SAFE_INTEGER + 1, platformFeeCents: 0 }]) {
    expect(() => deliveryAllocation('sim-delivery_zero-grau', allocation as never)).toThrow();
  }
  expect(deliveryAllocation('other')).toBeUndefined();
  expect(() => deliveryAllocation('other', { merchantAmountCents: 100, platformFeeCents: 5 })).toThrow();
});

test('preserves final total and exact merchant proceeds including zero-fee and zero-merchant charges', () => {
  for (const allocation of [{ merchantAmountCents: 10000, platformFeeCents: 537 },
    { merchantAmountCents: 29, platformFeeCents: 0 }, { merchantAmountCents: 0, platformFeeCents: 100 }]) {
    const total = allocation.merchantAmountCents + allocation.platformFeeCents;
    expect(quoteDeliveryCharge(total / 100, allocation)).toMatchObject({
      totalAmount: total / 100, netAmount: allocation.merchantAmountCents / 100,
      totalFeeAmount: allocation.platformFeeCents / 100, domFeeAmount: 0,
      financialSnapshot: { contract: 'SIM_DELIVERY_ALLOCATION_V1', totalAmountCents: total, ...allocation },
    });
  }
});

test('rejects mismatched totals, fractional cents and empty charges', () => {
  for (const price of [104.99, 105.001, 106, 0, -105]) {
    expect(() => quoteDeliveryCharge(price, { merchantAmountCents: 10000, platformFeeCents: 500 })).toThrow();
  }
  expect(() => quoteDeliveryCharge(0, { merchantAmountCents: 0, platformFeeCents: 0 })).toThrow();
});
