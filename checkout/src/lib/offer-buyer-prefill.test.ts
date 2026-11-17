import { describe, expect, test } from 'bun:test';
import { buyerPrefillFromQuery } from './offer-buyer-prefill';
import { offerRedirectTarget } from './legacy-offer-redirect';
import { checkoutTracking } from './payment-tracking';

const OWNER_LINK =
  'https://checkout.simintermediacoes.com/?subscriptionLinkCode=10244c5c-cc91-4ab8-a9fa-f70acd103da5&name=Aran+Leite+de+Gusm%C3%A3o&email=hyoretsu%40gmail.com&document=70267787499&phone=55839961337&src=8nemxtq6xkxsapi4&fbp=fb.1.1793909742215.7269715983';

describe('buyerPrefillFromQuery', () => {
  test('formata documento e telefone e apara nome/e-mail', () => {
    const p = new URLSearchParams(
      'name=%20Ana%20&email=%20a%40b.com&document=12345678909&phone=83999999999',
    );
    expect(buyerPrefillFromQuery(p)).toEqual({
      name: 'Ana',
      email: 'a@b.com',
      document: '123.456.789-09',
      phone: '(83) 99999-9999',
    });
  });

  test('normaliza o DDI 55 do telefone e mascara CNPJ', () => {
    const p = new URLSearchParams(
      'phone=5583999999999&document=11222333000181',
    );
    const r = buyerPrefillFromQuery(p);
    expect(r.phone).toBe('(83) 99999-9999');
    expect(r.document).toBe('11.222.333/0001-81');
  });

  test('query vazia resulta em campos vazios', () => {
    expect(buyerPrefillFromQuery(new URLSearchParams(''))).toEqual({
      name: '',
      email: '',
      document: '',
      phone: '',
    });
  });

  test('link legado do dono: redireciona para ?oferta= e preenche/rastreia', () => {
    const target = offerRedirectTarget(new URL(OWNER_LINK));
    expect(target?.searchParams.get('oferta')).toBe(
      '10244c5c-cc91-4ab8-a9fa-f70acd103da5',
    );
    expect(target?.searchParams.has('subscriptionLinkCode')).toBe(false);
    const prefill = buyerPrefillFromQuery(target!.searchParams);
    expect(prefill.name).toBe('Aran Leite de Gusmão');
    expect(prefill.email).toBe('hyoretsu@gmail.com');
    expect(prefill.document).toBe('702.677.874-99');
    expect(prefill.phone).toBe('(55) 83996-1337');
    expect(checkoutTracking(target!.search)).toEqual({
      src: '8nemxtq6xkxsapi4',
      fbp: 'fb.1.1793909742215.7269715983',
    });
  });
});
