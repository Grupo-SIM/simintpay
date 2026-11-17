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

  test('code=PX- vira ?oferta= e preserva a query', () => {
    const target = offerRedirectTarget(url('code=PX-AB12CD&email=a@b.c'));
    expect(target?.searchParams.get('oferta')).toBe('PX-AB12CD');
    expect(target?.searchParams.has('code')).toBe(false);
    expect(target?.searchParams.get('email')).toBe('a@b.c');
  });

  test('code= de plano de parceiro vira ?oferta=', () => {
    const target = offerRedirectTarget(url('code=3f8f67274&store=pagatg'));
    expect(target?.searchParams.get('oferta')).toBe('3f8f67274');
    expect(target?.searchParams.has('code')).toBe(false);
    expect(target?.searchParams.get('store')).toBe('pagatg');
  });

  test('data= (base64 { id, token }) vira ?oferta= com o id', () => {
    const data = btoa(JSON.stringify({ id: 'link-1', token: 't' }));
    const target = offerRedirectTarget(url(`data=${encodeURIComponent(data)}`));
    expect(target?.searchParams.get('oferta')).toBe('link-1');
    expect(target?.searchParams.has('data')).toBe(false);
    expect(offerRedirectTarget(url('data=%%%'))).toBeNull();
  });

  test('value= só vira ?oferta= quando é código de link, não valor em centavos', () => {
    const code = offerRedirectTarget(url('value=RX8Fap8kbp'));
    expect(code?.searchParams.get('oferta')).toBe('RX8Fap8kbp');
    expect(code?.searchParams.has('value')).toBe(false);
    const avulso = offerRedirectTarget(
      url('value=abc-123&description=link_avulso&adminToken=x'),
    );
    expect(avulso?.searchParams.get('oferta')).toBe('abc-123');
    expect(avulso?.searchParams.has('description')).toBe(false);
    expect(offerRedirectTarget(url('value=1990'))).toBeNull();
    expect(offerRedirectTarget(url('value=abc&orderNumber=9'))).toBeNull();
    expect(offerRedirectTarget(url('value=abc&description=Livro'))).toBeNull();
  });

  test('oferta existente e URL sem produto ficam como estão', () => {
    expect(offerRedirectTarget(url('oferta=abc&simLinkCode=x'))).toBeNull();
    expect(offerRedirectTarget(url('value=10&store=ebook'))).toBeNull();
  });
});
