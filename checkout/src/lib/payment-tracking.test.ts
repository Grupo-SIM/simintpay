import { describe, expect, test } from 'bun:test';
import { checkoutTracking } from './payment-tracking';

describe('checkoutTracking affiliate', () => {
  test('forwards aff and maps the ref alias to aff', () => {
    expect(checkoutTracking('?aff=ABC_12-x')).toEqual({ aff: 'ABC_12-x' });
    expect(checkoutTracking('?ref=ABC123')).toEqual({ aff: 'ABC123' });
    expect(checkoutTracking('?aff=AAA111&ref=BBB222')).toEqual({
      aff: 'AAA111',
    });
  });

  test('rejects malformed codes and never forwards financial fields', () => {
    for (const bad of ['ab', 'a'.repeat(41), 'a b c', 'x%3Cscript%3E', '']) {
      expect(checkoutTracking(`?aff=${bad}`)).toEqual({});
    }
    expect(
      checkoutTracking('?aff=ABC123&amount=1&commission=9&percentageBps=5000'),
    ).toEqual({ aff: 'ABC123' });
  });
});
