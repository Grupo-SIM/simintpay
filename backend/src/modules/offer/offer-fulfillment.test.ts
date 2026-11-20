import { describe, expect, test } from 'bun:test';
import {
  fulfillmentFunnelIssues,
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

describe('parseOfferFulfillment: arquivos e imagem', () => {
  test('mantém id e tamanho dos arquivos e valida imageUrl', () => {
    const f = parseOfferFulfillment({
      files: [
        { id: 'x1', fileName: 'a.pdf', fileSize: 10, fileUrl: 'https://s/a' },
        { fileName: 'b.pdf', fileUrl: 'https://s/b' },
      ],
      imageUrl: 'https://s/img.png',
    });
    expect(f.files[0]).toEqual({
      id: 'x1',
      fileName: 'a.pdf',
      fileSize: 10,
      fileUrl: 'https://s/a',
    });
    expect(f.files[1]).toEqual({ fileName: 'b.pdf', fileUrl: 'https://s/b' });
    expect(f.imageUrl).toBe('https://s/img.png');
    expect(parseOfferFulfillment(null).imageUrl).toBeNull();
    expect(() => parseOfferFulfillment({ imageUrl: 'ftp://x' })).toThrow();
  });
});

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

  test('rejects unknown keys, bad shapes, duplicate offers and downsell without upsell', () => {
    expect(issues('x')).toContain('objeto');
    expect(issues({ nope: 1 })).toContain('desconhecido');
    expect(issues({ files: [{ fileName: 'a' }] })).toContain('Arquivo');
    expect(issues({ bumps: [{ offerId: 'a', role: 'WAT' }] })).toContain(
      'role',
    );
    expect(issues({ bumps: [{ offerId: 'a', role: 'DOWNSELL' }] })).toContain(
      'Downsell exige',
    );
    expect(
      issues({
        bumps: [
          { offerId: 'a', role: 'BUMP' },
          { offerId: 'a', role: 'BUMP' },
        ],
      }),
    ).toContain('repetida');
  });

  test('accepts more than five bumps and multiple upsells and downsells', () => {
    const bumps = ['BUMP', 'UPSELL', 'DOWNSELL'].flatMap((role) =>
      Array.from({ length: 6 }, (_, i) => ({ offerId: `${role}-${i}`, role })),
    );
    expect(parseOfferFulfillment({ bumps }).bumps).toEqual(bumps);
    expect(readOfferFulfillment({ bumps }).bumps).toEqual(bumps);
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

describe('parseOfferFulfillment: extras do funil', () => {
  const base = { offerId: 'o1', role: 'UPSELL' };
  const parse = (b: Record<string, unknown>) =>
    parseOfferFulfillment({ bumps: [{ ...base, ...b }] }).bumps[0];

  test('bumps antigos continuam iguais e os extras são mantidos normalizados', () => {
    expect(parse({})).toEqual(base);
    expect(
      parse({
        headline: '  Só hoje ',
        originalAmountCents: 9000,
        countdownSeconds: 600,
        isActive: false,
      }),
    ).toEqual({
      ...base,
      headline: 'Só hoje',
      originalAmountCents: 9000,
      countdownSeconds: 600,
      isActive: false,
    });
    expect(parse({ headline: '', originalAmountCents: null })).toEqual(base);
  });

  test('rejeita valores inválidos e chaves desconhecidas', () => {
    const bad = (b: Record<string, unknown>) =>
      issues({ bumps: [{ ...base, ...b }] });
    expect(bad({ headline: 'x'.repeat(121) })).toMatch('headline');
    expect(bad({ originalAmountCents: 1.5 })).toMatch('originalAmountCents');
    expect(bad({ countdownSeconds: 29 })).toMatch('countdownSeconds');
    expect(bad({ countdownSeconds: 3601 })).toMatch('countdownSeconds');
    expect(bad({ isActive: 'no' })).toMatch('isActive');
    expect(bad({ foo: 1 })).toMatch('Campo desconhecido em bump: foo');
    expect(
      issues({
        bumps: [{ offerId: 'o1', role: 'BUMP', countdownSeconds: 60 }],
      }),
    ).toMatch('Cronômetro');
  });

  test('funil sem limite de quantidade; downsell exige upsell', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      offerId: `b${i}`,
      role: 'BUMP' as const,
    }));
    expect(fulfillmentFunnelIssues(many)).toEqual([]);
    expect(readOfferFulfillment({ bumps: many }).bumps).toHaveLength(7);
    const two = [
      { offerId: 'u1', role: 'UPSELL' as const },
      { offerId: 'u2', role: 'UPSELL' as const },
      { offerId: 'd1', role: 'DOWNSELL' as const },
      { offerId: 'd2', role: 'DOWNSELL' as const },
    ];
    expect(fulfillmentFunnelIssues(two)).toEqual([]);
    expect(
      fulfillmentFunnelIssues([{ offerId: 'd', role: 'DOWNSELL' }]),
    ).toEqual(['Downsell exige um upsell configurado']);
  });
});
