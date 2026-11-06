import { describe, expect, test } from 'bun:test';
import { Acquirer } from '../../core/services/acquirer.enum';
import {
  OfferValidationError,
  validateOfferInput,
  type OfferInput,
} from './offer.validator';

const base: OfferInput = {
  amountCents: 1499,
  acceptedMethods: ['PIX', 'CREDIT_CARD'],
  acquirer: Acquirer.DOM,
};
const issues = (input: Partial<OfferInput>): string => {
  try {
    validateOfferInput({ ...base, ...input });
  } catch (error) {
    expect(error).toBeInstanceOf(OfferValidationError);
    return (error as Error).message;
  }
  return '';
};

describe('validateOfferInput', () => {
  test('accepts the minimum and normalizes defaults', () => {
    const out = validateOfferInput({
      ...base,
      acceptedMethods: ['PIX', 'PIX'],
    });
    expect(out.acceptedMethods).toEqual(['PIX']);
    expect(out.renewalMode).toBe('NONE');
    expect(out.maxInstallments).toBe(1);
    expect(out.intervalType).toBeNull();
    expect(out.metadata).toBeNull();
  });

  test('rejects amounts below R$ 14,99', () => {
    expect(issues({ amountCents: 1498 })).toContain('R$ 14,99');
    expect(issues({ amountCents: 1499.5 })).toContain('R$ 14,99');
  });

  test('requires methods supported by the acquirer', () => {
    expect(issues({ acceptedMethods: [] })).toContain('ao menos um');
    expect(
      issues({ acceptedMethods: ['CREDIT_CARD'], acquirer: Acquirer.FRENDZ }),
    ).toContain('não suportados');
  });

  test('installments need credit card and capability', () => {
    expect(issues({ acceptedMethods: ['PIX'], maxInstallments: 3 })).toContain(
      'cartão de crédito',
    );
    expect(issues({ maxInstallments: 13 })).toContain('12x');
    expect(
      validateOfferInput({ ...base, maxInstallments: 12 }).maxInstallments,
    ).toBe(12);
  });

  test('NONE rejects interval and repetitions', () => {
    expect(issues({ intervalType: 'MONTH' })).toContain('sem renovação');
    expect(issues({ repetitions: 3 })).toContain('sem renovação');
  });

  test('recurring modes require interval', () => {
    expect(issues({ renewalMode: 'MANUAL_PAY' })).toContain('intervalo');
    const out = validateOfferInput({
      ...base,
      acceptedMethods: ['PIX'],
      renewalMode: 'MANUAL_PAY',
      intervalType: 'MONTH',
      intervalCount: 1,
      accessDays: 30,
    });
    expect(out.intervalCount).toBe(1);
    expect(out.accessDays).toBe(30);
  });

  test('AUTO_CHARGE requires stored-card capability', () => {
    const recurring = {
      renewalMode: 'AUTO_CHARGE' as const,
      intervalType: 'MONTH' as const,
      intervalCount: 1,
    };
    expect(issues({ ...recurring })).toBe('');
    expect(
      issues({
        ...recurring,
        acceptedMethods: ['PIX'],
        acquirer: Acquirer.FRENDZ,
      }),
    ).toContain('cartão salvo');
  });

  test('boleto only flags the address requirement', () => {
    const out = validateOfferInput({ ...base, acceptedMethods: ['BOLETO'] });
    expect(out.metadata).toEqual({ requiresBuyerAddress: true });
  });

  test('boleto due days: integer 0-90 (0 = no due date), kept next to requiresBuyerAddress', () => {
    for (const days of [0, 3, 90]) {
      const out = validateOfferInput({
        ...base,
        acceptedMethods: ['BOLETO'],
        metadata: { boletoDueDays: days },
      });
      expect(out.metadata).toEqual({
        boletoDueDays: days,
        requiresBuyerAddress: true,
      });
    }
    for (const bad of [-1, 91, 1.5, '3']) {
      expect(
        issues({
          acceptedMethods: ['BOLETO'],
          metadata: { boletoDueDays: bad },
        }),
      ).toContain('boletoDueDays');
    }
    // Sem BOLETO aceito o campo não é validado (nem exigido).
    expect(
      issues({ acceptedMethods: ['PIX'], metadata: { boletoDueDays: 500 } }),
    ).toBe('');
  });

  test('accessDays must be at least 1', () => {
    expect(issues({ accessDays: 0 })).toContain('Dias de acesso');
  });
});
