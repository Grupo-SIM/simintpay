import { describe, expect, test } from 'bun:test';
import {
  INVALID_LINK_MESSAGE,
  isPixExpired,
  isRenewalRequest,
  mapRenewalError,
  mapRenewalResponse,
  parseRenewalParams,
  renewalBody,
  renewalTitle,
  UP_TO_DATE_MESSAGE,
} from './offer-renewal-model';

const id = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b';
const sig = 'a'.repeat(64);
const q = (o: Record<string, string>) => new URLSearchParams(o);

describe('offer-renewal-model', () => {
  test('lê contrato e assinatura válidos, normalizando caixa', () => {
    expect(
      parseRenewalParams(
        q({ renovar: id.toUpperCase(), sig: sig.toUpperCase() }),
      ),
    ).toEqual({ contractId: id, sig });
  });

  test('rejeita uuid ou assinatura malformados/ausentes', () => {
    expect(parseRenewalParams(q({ renovar: 'x', sig }))).toBeNull();
    expect(parseRenewalParams(q({ renovar: id, sig: 'abc' }))).toBeNull();
    expect(parseRenewalParams(q({ renovar: id }))).toBeNull();
    expect(
      parseRenewalParams(q({ renovar: id, sig: 'g'.repeat(64) })),
    ).toBeNull();
  });

  test('detecta o pedido de renovação e monta o corpo só com PIX', () => {
    expect(isRenewalRequest(q({ renovar: 'x' }))).toBe(true);
    expect(isRenewalRequest(q({}))).toBe(false);
    expect(renewalBody({ contractId: id, sig })).toEqual({
      contractId: id,
      sig,
      paymentMethod: 'pix',
    });
  });

  test('mapeia a resposta com PIX', () => {
    expect(
      mapRenewalResponse({
        transactionId: 't1',
        kind: 'REACTIVATION',
        existing: true,
        amount: 49.9,
        pix: {
          pixContent: 'copia',
          qrCode: null,
          pixExpire: '2030-01-01 10:00:00',
        },
      }),
    ).toEqual({
      kind: 'REACTIVATION',
      existing: true,
      amount: 49.9,
      transactionId: 't1',
      pixContent: 'copia',
      qrCode: null,
      pixExpire: '2030-01-01 10:00:00',
    });
  });

  test('resposta sem transação ou sem PIX é inutilizável', () => {
    expect(mapRenewalResponse({ pix: { pixContent: 'x' } })).toBeNull();
    expect(mapRenewalResponse({ transactionId: 't', pix: {} })).toBeNull();
  });

  test('403 não revela o motivo', () => {
    const a = mapRenewalError(403, { message: 'Assinatura inválida' });
    const b = mapRenewalError(403, { message: 'qualquer outra coisa' });
    expect(a).toEqual(b);
    expect(a.message).toBe(INVALID_LINK_MESSAGE);
    expect(a.kind).toBe('invalid');
  });

  test('409 em dia vira estado amigável; outros 409 mostram a mensagem da API', () => {
    expect(
      mapRenewalError(409, { message: 'Assinatura em dia' }),
    ).toMatchObject({ kind: 'upToDate', message: UP_TO_DATE_MESSAGE });
    expect(
      mapRenewalError(409, { message: 'Assinatura cancelada' }),
    ).toMatchObject({
      kind: 'error',
      message: 'Assinatura cancelada',
      retryable: false,
    });
  });

  test('404 e erros inesperados', () => {
    expect(
      mapRenewalError(404, { message: 'Assinatura não encontrada' }).message,
    ).toBe('Assinatura não encontrada');
    expect(mapRenewalError(500)).toMatchObject({
      kind: 'error',
      retryable: true,
    });
  });

  test('títulos', () => {
    expect(renewalTitle(null)).toBe('Renovar assinatura');
    expect(renewalTitle('CYCLE')).toBe('Renovar assinatura');
    expect(renewalTitle('REACTIVATION')).toBe('Reativar assinatura');
  });

  test('PIX vencido só com data válida no passado', () => {
    const now = Date.parse('2030-01-01T12:00:00');
    expect(isPixExpired('2030-01-01 11:00:00', now)).toBe(true);
    expect(isPixExpired('2030-01-01 13:00:00', now)).toBe(false);
    expect(isPixExpired(null, now)).toBe(false);
    expect(isPixExpired('lixo', now)).toBe(false);
  });
});
