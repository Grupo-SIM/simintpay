import { describe, expect, test } from 'bun:test';
import { coproductionKeyFor } from './offer-coproduction';

describe('coproductionKeyFor', () => {
  test('a native offer keeps its agreement under `ofertas`', () => {
    expect(coproductionKeyFor({ id: 'o1' })).toEqual({
      product: 'ofertas',
      productId: 'o1',
    });
  });

  test.each([
    ['PaymentLink', 'links-pagamento'],
    ['SubscriptionLink', 'links-assinatura'],
    ['Boleto', 'boletos'],
    ['Plan', 'planos'],
    ['PixCreditPlan', 'planos-pix'],
  ])(
    'an offer migrated from %s reads the agreement of the original',
    (legacyType, product) => {
      expect(
        coproductionKeyFor({ id: 'o1', legacyType, legacyId: 'legacy-1' }),
      ).toEqual({ product, productId: 'legacy-1' });
    },
  );

  test('an unknown legacy type or a missing legacy id falls back to the offer itself', () => {
    expect(
      coproductionKeyFor({ id: 'o1', legacyType: 'Other', legacyId: 'x' }),
    ).toEqual({ product: 'ofertas', productId: 'o1' });
    expect(
      coproductionKeyFor({ id: 'o1', legacyType: 'Plan', legacyId: null }),
    ).toEqual({ product: 'ofertas', productId: 'o1' });
  });
});
