import { describe, expect, test } from 'bun:test';
import {
  coproductionCell,
  coproductionStateLabel,
  hasCoproducers,
  ownerSplit,
  userNetAmount,
} from './participations';

const owner = (myAmountCents: number | null, state = 'AVAILABLE') => ({
  role: 'OWNER' as const,
  readOnly: false,
  product: 'ofertas',
  myAmountCents,
  state,
});
const coproducer = {
  role: 'COPRODUCER' as const,
  readOnly: true,
  product: 'ofertas',
  myAmountCents: 2000,
  state: 'LOCKED',
};
const affiliateOwner = (commission: number | null) => ({
  role: 'OWNER' as const,
  readOnly: false,
  myAmountCents: null,
  state: 'AVAILABLE',
  isRenewal: false,
  affiliateCommissionCents: commission,
});

describe('participations', () => {
  test('labels coproduction states', () => {
    expect(coproductionStateLabel('LOCKED')).toBe('Em mediação');
    expect(coproductionStateLabel('REVERSED')).toBe('Estornada');
    expect(coproductionStateLabel(null)).toBe('Aguardando pagamento');
    expect(coproductionStateLabel('X')).toBe('X');
  });

  test('owner split: net minus coproducers minus affiliate', () => {
    // líquido 100,00; dono ficou com 55,00 depois do afiliado (10,00) e coprodutores (35,00)
    const split = ownerSplit({
      netAmount: '100.00',
      coproducao: owner(5500),
      afiliacao: affiliateOwner(1000),
    });
    expect(split).toEqual({
      netCents: 10000,
      coproducersCents: 3500,
      affiliateCents: 1000,
      remainingCents: 5500,
      coproducersPercentage: 35,
    });
  });

  test('owner with affiliate only keeps net minus commission', () => {
    const split = ownerSplit({
      netAmount: 100,
      coproducao: null,
      afiliacao: affiliateOwner(1000),
    });
    expect(split?.coproducersCents).toBe(0);
    expect(split?.remainingCents).toBe(9000);
  });

  test('owner without allocation yet leaves coproducers unknown', () => {
    const split = ownerSplit({
      netAmount: 100,
      coproducao: owner(null, null as never),
      afiliacao: null,
    });
    expect(split?.coproducersCents).toBeNull();
    expect(split?.remainingCents).toBe(10000);
  });

  test('no split for coproducer, affiliate or plain sales', () => {
    expect(
      ownerSplit({ netAmount: 100, coproducao: coproducer, afiliacao: null }),
    ).toBeNull();
    expect(
      ownerSplit({ netAmount: 100, coproducao: null, afiliacao: null }),
    ).toBeNull();
  });

  test('coproducer sees only the own part and state', () => {
    expect(
      coproductionCell({
        netAmount: 100,
        coproducao: coproducer,
        afiliacao: null,
      }),
    ).toEqual({ kind: 'COPRODUCER', myCents: 2000, state: 'LOCKED' });
  });

  test('owner cell reports what went to coproducers, excluding the affiliate', () => {
    expect(
      coproductionCell({
        netAmount: 100,
        coproducao: owner(5500, 'REVERSED'),
        afiliacao: affiliateOwner(1000),
      }),
    ).toEqual({
      kind: 'OWNER',
      divertedCents: 3500,
      percentage: 35,
      state: 'REVERSED',
    });
  });

  test('user net amount per role', () => {
    expect(
      userNetAmount({
        netAmount: 100,
        coproducao: owner(5500),
        afiliacao: affiliateOwner(1000),
      }),
    ).toBe(55);
    expect(
      userNetAmount({
        netAmount: 100,
        coproducao: null,
        afiliacao: affiliateOwner(1000),
      }),
    ).toBe(90);
    expect(
      userNetAmount({
        netAmount: 100,
        coproducao: coproducer,
        afiliacao: null,
      }),
    ).toBe(20);
    expect(
      userNetAmount({ netAmount: 100, coproducao: null, afiliacao: null }),
    ).toBe(100);
  });
});

describe('participations extras', () => {
  test('venda concluída só com afiliado não tem bloco de coprodução', () => {
    const co = { ...owner(null), state: null };
    expect(
      hasCoproducers({ status: 'COMPLETED' }, co, affiliateOwner(850)),
    ).toBe(false);
    expect(hasCoproducers({ status: 'PENDING' }, co, affiliateOwner(850))).toBe(
      true,
    );
    expect(
      hasCoproducers({ status: 'COMPLETED' }, owner(5950), affiliateOwner(850)),
    ).toBe(true);
    expect(hasCoproducers({ status: 'COMPLETED' }, coproducer, null)).toBe(
      true,
    );
  });
  test('venda estornada zera o líquido do usuário', () => {
    expect(
      userNetAmount({
        netAmount: 85,
        coproducao: { ...coproducer, state: 'REVERSED' },
        afiliacao: null,
      }),
    ).toBe(0);
  });
});
