import { describe, expect, test } from 'bun:test';
import { checkoutPreviewUrl, isPreviewSignal } from './payment-link-preview.ts';

describe('payment link preview messages', () => {
  test('accepts only the versioned checkout signals', () => {
    for (const type of ['ready', 'loaded', 'close']) {
      expect(
        isPreviewSignal(
          { type: `payment-link-preview:${type}`, version: 1 },
          type,
        ),
      ).toBe(true);
    }
    for (const data of [
      null,
      [],
      'ready',
      { type: 'payment-link-preview:ready', version: 2 },
      { type: 'payment-link-preview:ready', version: 1, token: 'secret' },
      { type: 'payment-link-preview:loaded', version: 1 },
    ]) {
      expect(isPreviewSignal(data, 'ready')).toBe(false);
    }
  });
  test('isolates preview URL from saved links and credentials', () => {
    const url = checkoutPreviewUrl(
      'https://checkout.simintermediacoes.com/old?token=secret',
      'https://dashboard.example',
    );
    expect(url.pathname).toBe('/preview/payment-link');
    expect([...url.searchParams.keys()]).toEqual(['parentOrigin']);
    expect(url.searchParams.get('parentOrigin')).toBe(
      'https://dashboard.example',
    );
    expect(() =>
      checkoutPreviewUrl(
        'https://user:secret@checkout.example',
        'https://dashboard.example',
      ),
    ).toThrow();
    expect(() =>
      checkoutPreviewUrl('javascript:alert(1)', 'https://dashboard.example'),
    ).toThrow();
    expect(() =>
      checkoutPreviewUrl(
        'http://external.example',
        'https://dashboard.example',
      ),
    ).toThrow();
  });
});
