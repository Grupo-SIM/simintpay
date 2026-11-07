import { describe, expect, test } from 'bun:test';
import {
  enumLabel,
  offerLabel,
  offerStatus,
  recurrenceSummary,
  statusLabels,
  usesLabel,
  type Offer,
} from './offers';

describe('offers', () => {
  test('enum desconhecido cai no valor bruto', () => {
    expect(enumLabel(statusLabels, 'ACTIVE')).toBe('Ativa');
    expect(enumLabel(statusLabels, 'NOVO')).toBe('NOVO');
    expect(enumLabel(statusLabels, null)).toBe('—');
  });

  test('rótulo da oferta é derivado dos atributos', () => {
    expect(offerLabel({ renewalMode: 'NONE', accessDays: null })).toBe(
      'Compra única',
    );
    expect(offerLabel({ renewalMode: 'NONE', accessDays: 30 })).toBe(
      'Acesso por tempo',
    );
    expect(offerLabel({ renewalMode: 'AUTO_CHARGE', accessDays: null })).toBe(
      'Assinatura no cartão',
    );
    expect(offerLabel({ renewalMode: 'MANUAL_PAY', accessDays: 30 })).toBe(
      'Assinatura por PIX',
    );
  });

  test('status segue a precedência inativa > expirada > esgotada > ativa', () => {
    const offer = {
      isActive: true,
      expiresAt: null,
      maxUses: 2,
      usedCount: 2,
    } as Offer;
    const now = new Date('2026-11-06T12:00:00Z');
    expect(offerStatus(offer, now)).toBe('EXHAUSTED');
    expect(offerStatus({ ...offer, isActive: false }, now)).toBe('INACTIVE');
    expect(offerStatus({ ...offer, usedCount: 0 }, now)).toBe('ACTIVE');
    const expired = { ...offer, expiresAt: '2026-11-01T00:00:00Z' };
    expect(offerStatus(expired, now)).toBe('EXPIRED');
    expect(offerStatus({ ...expired, isActive: false }, now)).toBe('INACTIVE');
    expect(statusLabels.EXPIRED).toBe('Expirada');
  });

  test('usos e recorrência em texto', () => {
    expect(usesLabel({ usedCount: 3, maxUses: 10 })).toBe('3 / 10');
    expect(usesLabel({ usedCount: 3, maxUses: null })).toBe('3');
    expect(recurrenceSummary({ renewalMode: 'NONE' } as Offer)).toBe(
      'Compra única',
    );
    expect(
      recurrenceSummary({
        renewalMode: 'MANUAL_PAY',
        intervalCount: 2,
        intervalType: 'MONTH',
      } as Offer),
    ).toBe('A cada 2 mês(es) · PIX a cada ciclo');
  });
});
