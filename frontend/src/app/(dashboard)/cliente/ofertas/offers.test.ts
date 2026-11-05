import { describe, expect, test } from 'bun:test';
import {
  enumLabel,
  formFromPreset,
  kindLabels,
  offerPayload,
  offerStatus,
  validateOfferForm,
  type Offer,
} from './offers';

describe('offers', () => {
  test('preset PIX_PLAN preenche recorrência manual e dias de acesso', () => {
    const form = formFromPreset('PIX_PLAN');
    expect(form.methods).toEqual(['PIX']);
    expect(form.renewalMode).toBe('MANUAL_PAY');
    expect(form.accessDays).toBe('30');
  });

  test('payload de compra única omite intervalo e só envia kind na criação', () => {
    const form = { ...formFromPreset('PAYMENT_LINK'), name: ' Mentoria ' };
    const created = offerPayload(form, 99.9, { platformTag: 'GLOBAL' });
    expect(created).toMatchObject({
      kind: 'PAYMENT_LINK',
      platformTag: 'GLOBAL',
      name: 'Mentoria',
      amountCents: 9990,
      renewalMode: 'NONE',
    });
    expect('intervalType' in created).toBe(false);
    expect('kind' in offerPayload(form, 99.9)).toBe(false);
  });

  test('payload recorrente envia intervalo e repetições', () => {
    const form = {
      ...formFromPreset('SUBSCRIPTION_LINK'),
      name: 'Clube',
      repetitions: '12',
    };
    expect(offerPayload(form, 29.9)).toMatchObject({
      renewalMode: 'AUTO_CHARGE',
      intervalType: 'MONTH',
      intervalCount: 1,
      repetitions: 12,
    });
  });

  test('validação cobre nome, valor mínimo, parcelas e cartão automático', () => {
    const base = { ...formFromPreset('PAYMENT_LINK'), name: 'X' };
    expect(validateOfferForm({ ...base, name: ' ' }, 50)).toMatch(/nome/);
    expect(validateOfferForm(base, 1)).toMatch(/mínimo/);
    expect(validateOfferForm({ ...base, methods: [] }, 50)).toMatch(/forma/);
    expect(
      validateOfferForm(
        { ...base, methods: ['PIX'], maxInstallments: '3' },
        50,
      ),
    ).toMatch(/crédito/);
    expect(
      validateOfferForm(
        { ...base, methods: ['PIX'], renewalMode: 'AUTO_CHARGE' },
        50,
      ),
    ).toMatch(/cartão/);
    expect(validateOfferForm(base, 50)).toBeNull();
  });

  test('enum desconhecido cai no valor bruto', () => {
    expect(enumLabel(kindLabels, 'PLAN')).toBe('Plano');
    expect(enumLabel(kindLabels, 'NOVO')).toBe('NOVO');
    expect(enumLabel(kindLabels, null)).toBe('—');
  });

  test('status considera ativo, expiração e limite de usos', () => {
    const offer = {
      isActive: true,
      expiresAt: null,
      maxUses: 2,
      usedCount: 2,
    } as Offer;
    expect(offerStatus(offer)).toBe('Limite atingido');
    expect(offerStatus({ ...offer, isActive: false })).toBe('Inativo');
    expect(offerStatus({ ...offer, usedCount: 0 })).toBe('Ativo');
  });
});
