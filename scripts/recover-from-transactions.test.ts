import { describe, expect, it } from 'bun:test';
import { customerFromTransaction, ownerFromDescription, parseBalances } from './recover-from-transactions';

describe('recover-from-transactions', () => {
  it('rejects lossy or ambiguous reviewed balances', () => {
    const row = { userId: 'seller', expectedBalance: '0.00', expectedLockedBalance: '0.00',
      balance: '-10.00', lockedBalance: '0.00' };
    expect(parseBalances([row])).toEqual([row]);
    expect(() => parseBalances([{ ...row, balance: 10 }])).toThrow();
    expect(() => parseBalances([{ ...row, lockedBalance: '-1.00' }])).toThrow();
    expect(() => parseBalances([row, row])).toThrow();
  });
  it('accepts only explicit platform and owner document tags', () => {
    expect(ownerFromDescription('[TENANT:EBOOKSIM] [CPF_DONO:12345678901] [NOME_DONO: Ana ]'))
      .toEqual({ document: '12345678901', platform: 'ebook', name: 'Ana' });
    expect(ownerFromDescription('[TENANT:UNKNOWN] [CPF_DONO:12345678901]')).toBeNull();
    expect(ownerFromDescription('[TENANT:EBOOK] [CPF_DONO:12345678901] [CNPJ_DONO:12345678901234]')).toBeNull();
  });

  it('requires usable customer identity without inventing missing fields', () => {
    const row = { userId: 'seller', customerDocument: '123.456.789-01',
      customerName: 'Maria', customerEmail: 'MARIA@example.com', customerPhone: null };
    expect(customerFromTransaction(row)).toEqual({ userId: 'seller', document: '12345678901',
      documentType: 'CPF', name: 'Maria', email: 'maria@example.com', phone: null });
    expect(customerFromTransaction({ ...row, customerEmail: null })).toBeNull();
    expect(customerFromTransaction({ ...row, customerDocument: '123' })).toBeNull();
  });
});
