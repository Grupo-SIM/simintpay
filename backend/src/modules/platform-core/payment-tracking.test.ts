import { expect, test } from 'bun:test';
import { paymentTracking } from './payment-tracking';
test('tracking accepts attribution only, bounded strings and never monetary/identity fields', () => {
  expect(
    paymentTracking({
      utm_source: 'meta',
      fbclid: 'id',
      amountCents: 1,
      netAmount: 999,
      customerDocument: '123',
      fbp: 'x'.repeat(501),
      src: {},
    }),
  ).toEqual({ utm_source: 'meta', fbclid: 'id' });
  expect(paymentTracking(null)).toEqual({});
  expect(paymentTracking([])).toEqual({});
});
test('aff accepts a valid code, ref is its alias and invalid codes are dropped', () => {
  expect(paymentTracking({ aff: 'Ab_9-xyz' })).toEqual({ aff: 'Ab_9-xyz' });
  expect(paymentTracking({ ref: 'Ab_9-xyz' })).toEqual({ aff: 'Ab_9-xyz' });
  expect(paymentTracking({ aff: 'GOOD1', ref: 'OTHER' })).toEqual({
    aff: 'GOOD1',
  });
  expect(paymentTracking({ aff: 'a@b.com' })).toEqual({});
  expect(paymentTracking({ aff: 'ab' })).toEqual({});
  expect(paymentTracking({ aff: 'x'.repeat(41) })).toEqual({});
  expect(paymentTracking({ aff: 12345 })).toEqual({});
});
