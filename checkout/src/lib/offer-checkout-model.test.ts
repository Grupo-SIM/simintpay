import { describe, expect, test } from 'bun:test';
import {
  availableMethods,
  chargeBody,
  isDeclined,
  isRecurringOffer,
  type PublicOffer,
} from './offer-checkout-model';

const offer: PublicOffer = {
  code: 'OF-1',
  name: 'Mentoria',
  description: null,
  amountCents: 9990,
  acceptedMethods: ['CREDIT_CARD', 'BOLETO', 'PIX'],
  maxInstallments: 3,
  renewalMode: 'NONE',
  intervalType: null,
  intervalCount: null,
};
const customer = {
  name: 'Ana',
  email: 'a@b.co',
  document: '12345678901',
  phone: '11999999999',
};

describe('offer checkout model', () => {
  test('lista PIX primeiro e ignora boleto', () => {
    expect(availableMethods(offer)).toEqual(['pix', 'credit_card']);
  });

  test('detecta oferta recorrente', () => {
    expect(isRecurringOffer(offer)).toBe(false);
    expect(isRecurringOffer({ ...offer, renewalMode: 'AUTO_CHARGE' })).toBe(
      true,
    );
  });

  test('corpo PIX não leva cartão nem parcelas', () => {
    const body = chargeBody({ method: 'pix', customer, installments: 3 });
    expect(body).toMatchObject({ paymentMethod: 'pix', documentType: 'CPF' });
    expect('card' in body).toBe(false);
    expect('installments' in body).toBe(false);
  });

  test('débito força 1x e crédito mantém as parcelas', () => {
    const card = { token: 't' };
    expect(
      chargeBody({ method: 'debit_card', customer, installments: 3, card }),
    ).toMatchObject({ installments: 1, card });
    expect(
      chargeBody({ method: 'credit_card', customer, installments: 3, card }),
    ).toMatchObject({ installments: 3 });
  });

  test('CNPJ é detectado pelo tamanho do documento', () => {
    expect(
      chargeBody({
        method: 'pix',
        customer: { ...customer, document: '12345678000190' },
        installments: 1,
      }).documentType,
    ).toBe('CNPJ');
  });

  test('status recusados', () => {
    expect(isDeclined('failed')).toBe(true);
    expect(isDeclined('PAID')).toBe(false);
    expect(isDeclined(undefined)).toBe(false);
  });
});
