import { describe, expect, test } from 'bun:test';
import {
  OfferFulfillmentError,
  isPrivateAddress,
  parseOfferFulfillment,
  readOfferFulfillment,
  unsafeUrlReason,
} from './offer-fulfillment';

const issues = (raw: unknown) => {
  try {
    parseOfferFulfillment(raw);
  } catch (e) {
    return (e as OfferFulfillmentError).issues.join('|');
  }
  return '';
};

describe('parseOfferFulfillment', () => {
  test('null becomes an empty delivery; a full document is normalized', () => {
    expect(parseOfferFulfillment(null).files).toEqual([]);
    const f = parseOfferFulfillment({
      files: [
        {
          fileName: ' a.pdf ',
          fileUrl: 'https://gateway.storjshare.io/b/a.pdf',
        },
      ],
      emailBody: ' hi ',
      redirectUrl: 'https://example.com/ok',
      communityId: 'c1',
      bumps: [
        { offerId: 'a', role: 'BUMP' },
        { offerId: 'b', role: 'UPSELL' },
        { offerId: 'c', role: 'DOWNSELL' },
      ],
    });
    expect(f.files[0].fileName).toBe('a.pdf');
    expect(f.emailBody).toBe('hi');
    expect(f.bumps).toHaveLength(3);
  });

  test('rejects unknown keys, bad shapes and funnel limits like the legacy link', () => {
    expect(issues('x')).toContain('objeto');
    expect(issues({ nope: 1 })).toContain('desconhecido');
    expect(issues({ files: [{ fileName: 'a' }] })).toContain('Arquivo');
    expect(issues({ bumps: [{ offerId: 'a', role: 'WAT' }] })).toContain(
      'role',
    );
    expect(
      issues({
        bumps: Array.from({ length: 6 }, (_, i) => ({
          offerId: `b${i}`,
          role: 'BUMP',
        })),
      }),
    ).toContain('order bumps');
    expect(issues({ bumps: [{ offerId: 'a', role: 'DOWNSELL' }] })).toContain(
      'Downsell exige',
    );
    expect(
      issues({
        bumps: [
          { offerId: 'a', role: 'UPSELL' },
          { offerId: 'b', role: 'UPSELL' },
        ],
      }),
    ).toContain('1 upsell');
    expect(
      issues({
        bumps: [
          { offerId: 'a', role: 'BUMP' },
          { offerId: 'a', role: 'BUMP' },
        ],
      }),
    ).toContain('repetida');
  });

  test('redirect URLs are SSRF-checked', () => {
    for (const url of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://169.254.169.254/latest',
      'http://10.0.0.5/x',
      'http://[::1]/x',
      'http://[::ffff:192.168.0.1]/x',
      'ftp://example.com/x',
      'https://user:pw@example.com/x',
      'http://intranet/x',
      'not a url',
    ])
      expect(issues({ redirectUrl: url })).toContain('redirectUrl');
    expect(issues({ redirectUrl: 'http://192.168.1.1' })).toContain(
      'redirectUrl',
    );
    expect(unsafeUrlReason('https://example.com/hook')).toBeNull();
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('172.20.1.1')).toBe(true);
  });

  test('stored invalid JSON reads as empty instead of throwing', () => {
    expect(
      readOfferFulfillment({ redirectUrl: 'http://localhost' }).redirectUrl,
    ).toBeNull();
  });
});
