import { expect, test } from 'bun:test';
import { offerPlatformReadsEnabled } from './offer-read-flag';

test('OFFER_PLATFORM_READS is off unless exactly "1"', () => {
  expect(offerPlatformReadsEnabled({})).toBe(false);
  expect(offerPlatformReadsEnabled({ OFFER_PLATFORM_READS: '0' })).toBe(false);
  expect(offerPlatformReadsEnabled({ OFFER_PLATFORM_READS: 'true' })).toBe(
    false,
  );
  expect(offerPlatformReadsEnabled({ OFFER_PLATFORM_READS: '1' })).toBe(true);
});
