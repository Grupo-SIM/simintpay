import { describe, expect, test } from 'bun:test';
import {
  affiliationAmountCents,
  affiliationStateLabel,
  isAffiliateOnly,
} from './affiliation';

const affiliate = {
  role: 'AFFILIATE' as const,
  readOnly: true,
  myAmountCents: 1000,
  state: 'AVAILABLE',
  isRenewal: false,
};
const owner = {
  role: 'OWNER' as const,
  readOnly: false,
  myAmountCents: null,
  state: 'REVERSED',
  isRenewal: true,
  affiliateCommissionCents: 700,
  affiliateCode: 'ABC123',
};

describe('affiliation helpers', () => {
  test('labels states in Portuguese and keeps unknown values visible', () => {
    expect(affiliationStateLabel('AVAILABLE')).toBe('Creditada');
    expect(affiliationStateLabel('LOCKED')).toBe('Pendente');
    expect(affiliationStateLabel('REVERSED')).toBe('Revertida');
    expect(affiliationStateLabel(null)).toBe('Aguardando pagamento');
    expect(affiliationStateLabel('NEW_STATE')).toBe('NEW_STATE');
  });
  test('shows the own amount to the affiliate and the commission paid to the owner', () => {
    expect(affiliationAmountCents(affiliate)).toBe(1000);
    expect(affiliationAmountCents(owner)).toBe(700);
    expect(
      affiliationAmountCents({ ...owner, affiliateCommissionCents: null }),
    ).toBeNull();
  });
  test('affiliate-only hides buyer and fees; coproduction keeps the full read-only view', () => {
    expect(isAffiliateOnly({ afiliacao: affiliate, coproducao: null })).toBe(
      true,
    );
    expect(
      isAffiliateOnly({
        afiliacao: affiliate,
        coproducao: {
          role: 'COPRODUCER',
          readOnly: true,
          product: 'ofertas',
          myAmountCents: 2000,
          state: 'AVAILABLE',
        },
      }),
    ).toBe(false);
    expect(isAffiliateOnly({ afiliacao: owner, coproducao: null })).toBe(false);
    expect(isAffiliateOnly({ afiliacao: null, coproducao: null })).toBe(false);
  });
});
