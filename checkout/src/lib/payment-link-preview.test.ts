import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { proxy, config } from '../proxy';
import {
  configuredPreviewParents,
  isAllowedPreviewParent,
  previewFramePolicy,
} from './payment-link-preview';

describe('preview embedding policy', () => {
  test('production accepts only exact configured HTTPS origins', () => {
    expect(
      isAllowedPreviewParent(
        'https://simintpay.com',
        'https://simintpay.com',
        false,
      ),
    ).toBe(true);
    for (const origin of [
      'https://simintpay.com.evil.test',
      'http://simintpay.com',
      'http://localhost:3100',
      'https://localhost:3100',
    ]) {
      expect(
        isAllowedPreviewParent(origin, 'https://simintpay.com', false),
      ).toBe(false);
    }
    expect(isAllowedPreviewParent('https://simintpay.com', '', false)).toBe(
      false,
    );
  });
  test('development additionally permits localhost ports', () => {
    expect(isAllowedPreviewParent('http://localhost:3100', '', true)).toBe(
      true,
    );
    expect(isAllowedPreviewParent('http://127.0.0.1:3100', '', true)).toBe(
      true,
    );
    expect(isAllowedPreviewParent('http://evil.test:3100', '', true)).toBe(
      false,
    );
    expect(previewFramePolicy([], true)).toContain('http://localhost:*');
    expect(previewFramePolicy([], false)).toBe("frame-ancestors 'none'");
  });
  test('route receives CSP, no-store and no-referrer; normal routes are outside matcher', () => {
    const response = proxy(
      new NextRequest('https://checkout.simintermediacoes.com/preview/funnel'),
    );
    expect(response.headers.get('Content-Security-Policy')).toBe(
      previewFramePolicy(
        configuredPreviewParents(),
        process.env.NODE_ENV === 'development',
      ),
    );
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.has('X-Frame-Options')).toBe(false);
    expect(config.matcher).toEqual(['/', '/preview/offer', '/preview/funnel']);
    expect(
      new NextRequest('https://checkout.simintermediacoes.com/preview/funnel')
        .nextUrl.pathname,
    ).toBe(config.matcher[2]);
  });
});
