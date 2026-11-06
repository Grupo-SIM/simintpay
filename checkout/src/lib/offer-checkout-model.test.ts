import { describe, expect, test } from 'bun:test';
import {
  availableMethods,
  boletoAddressBody,
  boletoPaymentNotice,
  chargeBody,
  formatBoletoDueDate,
  isDeclined,
  isRecurringOffer,
  mapBoletoResponse,
  type PublicOffer,
} from './offer-checkout-model';
import { maskCep } from './input-masks';

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
  test('lista PIX primeiro, boleto por último', () => {
    expect(availableMethods(offer)).toEqual(['pix', 'credit_card', 'boleto']);
    expect(
      availableMethods({ ...offer, acceptedMethods: ['PIX', 'DEBIT_CARD'] }),
    ).toEqual(['pix', 'debit_card']);
    expect(availableMethods({ ...offer, acceptedMethods: ['BOLETO'] })).toEqual(
      ['boleto'],
    );
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

  const address = {
    cep: '50000-000',
    rua: ' Rua A ',
    numero: ' 10 ',
    bairro: 'Centro',
    cidade: 'Recife',
    uf: 'pe',
    complemento: ' ap 2 ',
  };

  test('corpo do boleto leva o endereço normalizado e nada de cartão', () => {
    const body = chargeBody({
      method: 'boleto',
      customer,
      installments: 3,
      address,
    });
    expect(body).toMatchObject({
      paymentMethod: 'boleto',
      customerDocument: '12345678901',
      documentType: 'CPF',
      cep: '50000000',
      rua: 'Rua A',
      numero: '10',
      bairro: 'Centro',
      cidade: 'Recife',
      uf: 'PE',
      complemento: 'ap 2',
    });
    expect('card' in body).toBe(false);
    expect('installments' in body).toBe(false);
    expect(
      boletoAddressBody({ ...address, complemento: undefined }).complemento,
    ).toBe('');
  });

  test('resposta do boleto: link e/ou linha digitável; vencimento opcional', () => {
    expect(
      mapBoletoResponse({
        id: 'dom-1',
        boletoUrl: ' https://x/boleto.pdf ',
        boletoDigitableLine: '34191.79',
        boletoExpiresAt: '2026-12-10',
        amount: 105,
      }),
    ).toEqual({
      paymentId: 'dom-1',
      amount: 105,
      url: 'https://x/boleto.pdf',
      digitableLine: '34191.79',
      dueDate: '2026-12-10',
    });
    const noDue = mapBoletoResponse({
      transactionId: 'tx-1',
      boletoDigitableLine: '34191.79',
      boletoExpiresAt: null,
    });
    expect(noDue).toMatchObject({
      paymentId: 'tx-1',
      url: null,
      dueDate: null,
    });
    expect(mapBoletoResponse({ id: 'x' })).toBeNull();
    expect(
      mapBoletoResponse({ boletoUrl: '  ', boletoDigitableLine: '' }),
    ).toBeNull();
  });

  test('aviso e data de vencimento', () => {
    expect(formatBoletoDueDate('2026-12-10')).toBe('10/12/2026');
    expect(formatBoletoDueDate('2026-12-10T00:00:00.000Z')).toBe('10/12/2026');
    expect(formatBoletoDueDate(null)).toBeNull();
    expect(boletoPaymentNotice('2026-12-10')).toBe(
      'Pague até 10/12/2026 e você receberá a confirmação por e-mail.',
    );
    expect(boletoPaymentNotice(null)).toBe(
      'Pague o boleto e você receberá a confirmação por e-mail.',
    );
  });

  test('máscara de CEP', () => {
    expect(maskCep('50000')).toBe('50000');
    expect(maskCep('50000000')).toBe('50000-000');
    expect(maskCep('50.000-0009999')).toBe('50000-000');
  });
});
