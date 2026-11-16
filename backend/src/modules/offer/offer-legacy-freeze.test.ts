import { expect, test } from 'bun:test';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  assertOfferLegacyWritable,
  OfferLegacyFreezeGuard,
  offerLegacyFreezeEnabled,
} from './offer-legacy-freeze';

test('OFFER_LEGACY_FREEZE is off unless "1" or "true"', () => {
  expect(offerLegacyFreezeEnabled({})).toBe(false);
  expect(offerLegacyFreezeEnabled({ OFFER_LEGACY_FREEZE: '0' })).toBe(false);
  expect(offerLegacyFreezeEnabled({ OFFER_LEGACY_FREEZE: '' })).toBe(false);
  expect(offerLegacyFreezeEnabled({ OFFER_LEGACY_FREEZE: '1' })).toBe(true);
  expect(offerLegacyFreezeEnabled({ OFFER_LEGACY_FREEZE: ' TRUE ' })).toBe(
    true,
  );
});

test('assert passes when off and answers 503 with a clear message when on', () => {
  expect(() => assertOfferLegacyWritable({})).not.toThrow();
  try {
    assertOfferLegacyWritable({ OFFER_LEGACY_FREEZE: '1' });
    throw new Error('expected 503');
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse() as {
      code: string;
      message: string;
    };
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect(body.code).toBe('OFFER_LEGACY_FREEZE');
    expect(body.message).toContain('migrando');
  }
});

test('the guard lets requests through when off and sends Retry-After when on', () => {
  const headers: Record<string, string> = {};
  const context = {
    switchToHttp: () => ({
      getResponse: () => ({
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      }),
    }),
  } as never;
  const guard = new OfferLegacyFreezeGuard();
  const previous = process.env.OFFER_LEGACY_FREEZE;
  try {
    delete process.env.OFFER_LEGACY_FREEZE;
    expect(guard.canActivate(context)).toBe(true);
    process.env.OFFER_LEGACY_FREEZE = '1';
    expect(() => guard.canActivate(context)).toThrow(
      ServiceUnavailableException,
    );
    expect(headers['Retry-After']).toBe('300');
  } finally {
    if (previous === undefined) delete process.env.OFFER_LEGACY_FREEZE;
    else process.env.OFFER_LEGACY_FREEZE = previous;
  }
});
