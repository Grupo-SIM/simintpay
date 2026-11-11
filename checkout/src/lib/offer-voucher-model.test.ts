import { describe, expect, test } from 'bun:test';
import {
  mapVoucherQuote,
  validateVoucherBody,
  voucherErrorMessage,
  voucherField,
} from './offer-voucher-model';
import { chargeBody } from './offer-checkout-model';
import { subscribeBody } from './offer-subscribe-model';

const pricing = { options: [], pixAmount: 80, debitAmount: 80 };
const customer = {
  name: 'Ana',
  email: 'ana@test.dev',
  document: '12345678909',
  phone: '11999990000',
};

describe('offer voucher model', () => {
  test('corpo da validação apara o código', () => {
    expect(validateVoucherBody('  OFF20 ')).toEqual({ voucherCode: 'OFF20' });
  });

  test('resposta válida exige desconto, valor final e preços', () => {
    const quote = {
      valid: true,
      code: 'OFF20',
      originalAmountCents: 10000,
      discountAmountCents: 2000,
      finalAmountCents: 8000,
      pricing,
    };
    expect(mapVoucherQuote(quote)).toEqual(quote);
    expect(mapVoucherQuote({ ...quote, pricing: undefined })).toBeNull();
    expect(mapVoucherQuote({ ...quote, valid: false })).toBeNull();
    expect(mapVoucherQuote(null)).toBeNull();
  });

  test('mensagem de erro usa a da API ou o texto padrão', () => {
    expect(voucherErrorMessage({ message: 'Voucher expirado' })).toBe(
      'Voucher expirado',
    );
    expect(voucherErrorMessage({})).toBe('Cupom inválido ou expirado');
  });

  test('o código só vai nos corpos quando há cupom aplicado', () => {
    expect(voucherField(null)).toEqual({});
    const applied = { code: 'OFF20', quote: {} as never };
    expect(voucherField(applied)).toEqual({ voucherCode: 'OFF20' });
    expect(
      chargeBody({ method: 'pix', customer, installments: 1 }),
    ).not.toHaveProperty('voucherCode');
    expect(
      chargeBody({
        method: 'pix',
        customer,
        installments: 1,
        ...voucherField(applied),
      }),
    ).toMatchObject({ voucherCode: 'OFF20' });
    expect(
      subscribeBody({ method: 'pix', customer, ...voucherField(applied) }),
    ).toMatchObject({ voucherCode: 'OFF20' });
  });
});
