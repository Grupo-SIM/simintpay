import { describe, expect, test } from 'bun:test';
import { offerRedirectTarget } from './legacy-offer-redirect';

const url = (query: string) => new URL(`https://pay.test/?${query}`);

describe('legacy offer redirect', () => {
  test('parâmetros legados viram ?oferta= preservando o restante da query', () => {
    for (const param of [
      'simLinkCode',
      'subscriptionLinkCode',
      'simBoletoCode',
      'simPlanCode',
      'linkCode',
      'subscriptionCode',
    ]) {
      const target = offerRedirectTarget(url(`${param}=abc&utm=x&name=Ana`));
      expect(target?.searchParams.get('oferta')).toBe('abc');
      expect(target?.searchParams.has(param)).toBe(false);
      expect(target?.searchParams.get('utm')).toBe('x');
      expect(target?.searchParams.get('name')).toBe('Ana');
    }
  });

  test('ofertaCode também vira ?oferta=', () => {
    const target = offerRedirectTarget(url('ofertaCode=abc'));
    expect(target?.searchParams.get('oferta')).toBe('abc');
    expect(target?.searchParams.has('ofertaCode')).toBe(false);
  });

  test('oferta existente, plano PIX (code=PX-) e URL sem produto ficam como estão', () => {
    expect(offerRedirectTarget(url('oferta=abc&simLinkCode=x'))).toBeNull();
    expect(offerRedirectTarget(url('code=PX-1'))).toBeNull();
    expect(offerRedirectTarget(url('value=10&store=ebook'))).toBeNull();
  });
});
