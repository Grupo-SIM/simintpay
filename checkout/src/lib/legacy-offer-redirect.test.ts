import { describe, expect, test } from 'bun:test';
import {
  legacyRedirectEnabled,
  offerRedirectTarget,
} from './legacy-offer-redirect';

const url = (query: string) => new URL(`https://pay.test/?${query}`);

describe('legacy offer redirect', () => {
  test('flag fica desligada por padrão', () => {
    expect(legacyRedirectEnabled(undefined)).toBe(false);
    expect(legacyRedirectEnabled('false')).toBe(false);
    expect(legacyRedirectEnabled(' TRUE ')).toBe(true);
  });

  test('parâmetro legado não redireciona com a flag desligada', () => {
    expect(
      offerRedirectTarget(url('simLinkCode=abc'), { legacyEnabled: false }),
    ).toBeNull();
  });

  test('parâmetros legados viram ?oferta= com a flag ligada', () => {
    for (const param of [
      'simLinkCode',
      'subscriptionLinkCode',
      'simBoletoCode',
      'simPlanCode',
      'linkCode',
      'subscriptionCode',
    ]) {
      const target = offerRedirectTarget(url(`${param}=abc&utm=x`), {
        legacyEnabled: true,
      });
      expect(target?.searchParams.get('oferta')).toBe('abc');
      expect(target?.searchParams.has(param)).toBe(false);
      expect(target?.searchParams.get('utm')).toBe('x');
    }
  });

  test('ofertaCode sempre redireciona, mesmo com a flag desligada', () => {
    const target = offerRedirectTarget(url('ofertaCode=abc'), {
      legacyEnabled: false,
    });
    expect(target?.searchParams.get('oferta')).toBe('abc');
    expect(target?.searchParams.has('ofertaCode')).toBe(false);
  });

  test('oferta existente e plano PIX (code=PX-) ficam como estão', () => {
    expect(
      offerRedirectTarget(url('oferta=abc&simLinkCode=x'), {
        legacyEnabled: true,
      }),
    ).toBeNull();
    expect(
      offerRedirectTarget(url('code=PX-1'), { legacyEnabled: true }),
    ).toBeNull();
  });
});
