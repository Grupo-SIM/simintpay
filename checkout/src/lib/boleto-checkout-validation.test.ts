import { describe, expect, it } from 'bun:test';
import { validateBoletoCheckout } from './boleto-checkout-validation';

const fields = {
  name: 'Cliente Teste',
  document: '123.456.789-00',
  email: 'cliente@example.com',
  phone: '(11) 3333-4444',
  cep: '01001-000',
  rua: 'Praça da Sé',
  numero: '123',
  bairro: 'Sé',
  cidade: 'São Paulo',
  uf: 'SP',
};

describe('boleto checkout validation', () => {
  it('accepts complete data with landline or mobile phone', () => {
    expect(validateBoletoCheckout(fields)).toEqual({
      dadosOk: true,
      enderecoOk: true,
    });
    expect(
      validateBoletoCheckout({ ...fields, phone: '(11) 99999-9999' }).dadosOk,
    ).toBe(true);
  });
  it('identifies missing address independently of buyer data', () => {
    expect(validateBoletoCheckout({ ...fields, uf: '' })).toEqual({
      dadosOk: true,
      enderecoOk: false,
    });
  });
  it('rejects incomplete phone and invalid email consistently', () => {
    expect(
      validateBoletoCheckout({ ...fields, phone: '(11) 3333-444' }).dadosOk,
    ).toBe(false);
    expect(
      validateBoletoCheckout({ ...fields, email: 'cliente@' }).dadosOk,
    ).toBe(false);
  });
});
