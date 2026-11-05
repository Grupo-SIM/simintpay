import { expect, test } from 'bun:test';
import { Acquirer } from '../../core/services/acquirer.enum';
import { generateOfferCode } from './offer-code';
import { OFFER_PRESETS } from './offer.presets';
import { validateOfferInput } from './offer.validator';

test('every legacy preset is a valid offer on the DOM acquirer', () => {
  for (const kind of Object.keys(
    OFFER_PRESETS,
  ) as (keyof typeof OFFER_PRESETS)[]) {
    expect(() =>
      validateOfferInput({
        ...OFFER_PRESETS[kind],
        amountCents: 1499,
        acquirer: Acquirer.DOM,
      }),
    ).not.toThrow();
  }
});

test('generates unambiguous, distinct public codes', () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateOfferCode()));
  expect(codes.size).toBe(200);
  for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
  expect(generateOfferCode(6)).toHaveLength(6);
});
