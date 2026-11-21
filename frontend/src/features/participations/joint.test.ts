import { describe, expect, test } from 'bun:test';
import { affiliatesFromDraft, jointMessage, jointTotal } from './joint';

const co = (email: string, bps: number, name?: string) => ({
  email,
  name,
  bps,
});
const aff = (
  label: string,
  bps: number,
  level: 'offer' | 'platform' = 'platform',
  email?: string,
) => ({ label, email, name: label, bps, level });

describe('jointTotal', () => {
  test('somam pessoas diferentes sobre o mesmo líquido', () => {
    const r = jointTotal({
      coproducers: [co('a@x.com', 500)],
      coproducerLevel: 'platform',
      affiliates: [aff('B', 500, 'platform', 'b@x.com')],
    });
    expect(r.totalBps).toBe(1000);
    expect(r.ownerBps).toBe(9000);
    expect(r.exceeds).toBe(false);
  });
  test('usa o pior afiliado, não a soma deles', () => {
    const r = jointTotal({
      coproducers: [co('a@x.com', 5000)],
      coproducerLevel: 'platform',
      affiliates: [
        aff('B', 3000, 'platform', 'b@x.com'),
        aff('C', 4000, 'platform', 'c@x.com'),
      ],
    });
    expect(r.totalBps).toBe(9000);
    expect(r.affiliate?.label).toBe('C');
  });
  test('excedente bloqueia e informa quem excede', () => {
    const r = jointTotal({
      coproducers: [co('a@x.com', 7000)],
      coproducerLevel: 'offer',
      affiliates: [aff('B', 4000, 'offer', 'b@x.com')],
    });
    expect(r.exceeds).toBe(true);
    expect(r.overBps).toBe(1000);
    expect(jointMessage(r)).toContain('110%');
    expect(jointMessage(r)).toContain('afiliado B 40%');
  });
  test('mesma pessoa, empate: vale o coprodutor, contada uma vez', () => {
    const r = jointTotal({
      coproducers: [co('a@x.com', 6000)],
      coproducerLevel: 'platform',
      affiliates: [aff('A', 6000, 'platform', 'a@x.com')],
    });
    expect(r.totalBps).toBe(6000);
    expect(r.exceeds).toBe(false);
    expect(r.overlaps).toEqual(['A']);
  });
  test('afiliado da oferta vence coprodutor da plataforma', () => {
    const r = jointTotal({
      coproducers: [co('a@x.com', 3000), co('d@x.com', 2000)],
      coproducerLevel: 'platform',
      affiliates: [aff('A', 8000, 'offer', 'a@x.com')],
    });
    expect(r.totalBps).toBe(10000);
    expect(r.exceeds).toBe(false);
  });
  test('herdado sem e-mail casa pelo nome', () => {
    const r = jointTotal({
      coproducers: [co('a@x.com', 6000, 'Ana')],
      coproducerLevel: 'platform',
      affiliates: [aff('Ana', 6000)],
    });
    expect(r.totalBps).toBe(6000);
  });
});

describe('affiliatesFromDraft', () => {
  const draft = {
    rows: [{ id: '1', email: 'x@x.com', percentage: '' }],
    defaultPercentage: '10',
    renewals: 'all' as const,
    linkBaseUrl: '',
  };
  test('oferta soma herdados e o global da oferta vale também para eles', () => {
    const list = affiliatesFromDraft(
      draft,
      {
        defaultPercentageBps: null,
        commissionOnRenewals: true,
        affiliates: [{ name: 'P', code: 'abc', percentageBps: 500 }],
      },
      false,
    );
    expect(list.map((i) => [i.label, i.bps, i.level])).toEqual([
      ['x@x.com', 1000, 'offer'],
      ['P', 1000, 'offer'],
    ]);
  });
  test('linha sem percentual efetivo é ignorada', () => {
    expect(
      affiliatesFromDraft({ ...draft, defaultPercentage: '' }, undefined, true),
    ).toEqual([]);
  });
});
