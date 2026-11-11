import { describe, expect, test } from 'bun:test';
import { coproductionKeyFor } from './offer-coproduction';

describe('coproductionKeyFor', () => {
  test('an offer keeps its agreement under `ofertas` with its own id', () => {
    expect(coproductionKeyFor({ id: 'o1' })).toEqual({
      product: 'ofertas',
      productId: 'o1',
    });
  });

  test('an offer migrated from a legacy product (same id) reads the renamed agreement', () => {
    expect(
      coproductionKeyFor({ id: 'legacy-1', legacyType: 'PaymentLink' } as {
        id: string;
      }),
    ).toEqual({ product: 'ofertas', productId: 'legacy-1' });
  });
});
