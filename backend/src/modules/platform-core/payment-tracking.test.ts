import { expect, test } from 'bun:test';
import { paymentTracking } from './payment-tracking';
test('tracking accepts attribution only, bounded strings and never monetary/identity fields', () => {
  expect(paymentTracking({ utm_source: 'meta', fbclid: 'id', amountCents: 1, netAmount: 999, customerDocument: '123', fbp: 'x'.repeat(501), src: {} })).toEqual({ utm_source: 'meta', fbclid: 'id' });
  expect(paymentTracking(null)).toEqual({});
  expect(paymentTracking([])).toEqual({});
});
