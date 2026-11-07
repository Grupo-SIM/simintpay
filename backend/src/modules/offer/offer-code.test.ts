import { expect, test } from 'bun:test';
import { generateOfferCode } from './offer-code';

test('generates unambiguous, distinct public codes', () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateOfferCode()));
  expect(codes.size).toBe(200);
  for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
  expect(generateOfferCode(6)).toHaveLength(6);
});
