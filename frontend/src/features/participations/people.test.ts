import { describe, expect, test } from 'bun:test';
import {
  buildDraft,
  changedParts,
  personChips,
  splitDraft,
  visiblePeople,
} from './people';
import { computeTotals, validateDraft } from './validate';
import type { Agreements, ParticipationsContext } from './types';

const co = {
  basis: 'NET' as const,
  version: 3,
  participants: [{ email: 'ana@x.test', name: 'Ana', percentageBps: 1000 }],
};
const aff = {
  version: 2,
  defaultPercentageBps: 500,
  commissionOnRenewals: true,
  linkBaseUrl: 'https://loja.test',
  affiliates: [
    { email: 'ana@x.test', name: 'Ana', code: 'ANA1', percentageBps: null },
    { email: 'bia@x.test', name: 'Bia', code: 'BIA1', percentageBps: 2000 },
  ],
};
const margin = {
  version: 4,
  defaultPercentageBps: 3000,
  commissionOnRenewals: true,
  affiliates: [{ email: 'bia@x.test', name: 'Bia', percentageBps: null }],
  coproducers: [{ email: 'cai@x.test', name: 'Cai', percentageBps: 2000 }],
};
const admin: ParticipationsContext = {
  platform: true,
  admin: true,
  allowInheritance: false,
};
const owner: ParticipationsContext = {
  ...admin,
  admin: false,
  ownerEmail: 'dono@x.test',
};
const full: Agreements = { co, aff, margin };

describe('buildDraft / splitDraft', () => {
  test('mescla por e-mail e devolve os mesmos payloads', () => {
    const draft = buildDraft(full, admin);
    expect(draft.people.map((p) => p.email).sort()).toEqual([
      'ana@x.test',
      'bia@x.test',
      'cai@x.test',
    ]);
    const ana = draft.people.find((p) => p.email === 'ana@x.test')!;
    expect(ana.coProduct).toEqual({ on: true, percentage: '10' });
    expect(ana.affProduct).toEqual({ on: true, percentage: '' });
    const plan = splitDraft(draft, admin);
    expect(plan.margin?.coproducers).toEqual([
      { email: 'cai@x.test', percentageBps: 2000 },
    ]);
    expect(plan.margin?.defaultPercentageBps).toBe(3000);
    expect(plan.aff.defaultPercentageBps).toBe(500);
    expect(
      changedParts(plan, splitDraft(buildDraft(full, admin), admin)),
    ).toEqual([]);
  });

  test('só os acordos alterados entram na lista de gravação', () => {
    const draft = buildDraft(full, admin);
    const next = {
      ...draft,
      people: draft.people.map((p) =>
        p.email === 'cai@x.test'
          ? { ...p, coMargin: { on: true, percentage: '25' } }
          : p,
      ),
    };
    expect(
      changedParts(splitDraft(next, admin), splitDraft(draft, admin)),
    ).toEqual(['margin']);
  });

  test('não admin não envia margem e não enxerga quem só tem margem', () => {
    const draft = buildDraft({ co, aff }, owner);
    expect(splitDraft(draft, owner).margin).toBeUndefined();
    const adminDraft = buildDraft(full, admin);
    expect(visiblePeople(adminDraft, false).map((p) => p.email)).not.toContain(
      'cai@x.test',
    );
    expect(visiblePeople(adminDraft, true)).toHaveLength(3);
  });

  test('chips resumem cada participação', () => {
    const draft = buildDraft(full, admin);
    const ana = draft.people.find((p) => p.email === 'ana@x.test')!;
    expect(personChips(ana, { affiliate: '5' }, true)).toEqual([
      'Coprodutor · Produto 10%',
      'Afiliado · Produto padrão 5%',
    ]);
    const cai = draft.people.find((p) => p.email === 'cai@x.test')!;
    expect(personChips(cai, {}, true)).toEqual(['Coprodutor · Margem 20%']);
    expect(personChips(cai, {}, false)).toEqual([]);
  });
});

describe('validateDraft', () => {
  test('dados do servidor são válidos', () => {
    expect(validateDraft(buildDraft(full, admin), full, admin)).toBeNull();
  });

  test('produto: coprodutor + afiliado acima de 100% do líquido', () => {
    const draft = buildDraft(full, admin);
    const next = {
      ...draft,
      people: draft.people.map((p) =>
        p.email === 'ana@x.test'
          ? { ...p, coProduct: { on: true, percentage: '90' } }
          : p,
      ),
    };
    expect(validateDraft(next, full, admin)).toMatch(/100%/);
    expect(computeTotals(next, full, admin).joint.exceeds).toBe(true);
  });

  test('afiliado sem percentual e sem global é inválido', () => {
    const draft = buildDraft(full, admin);
    const next = {
      ...draft,
      settings: { ...draft.settings, defaultPercentage: '' },
    };
    expect(validateDraft(next, full, admin)).toMatch(/percentual/i);
  });

  test('margem: coprodutores + maior afiliado que não é coprodutor', () => {
    const draft = buildDraft(full, admin);
    // Cai 20% + Bia (global 30%) = 50%
    expect(computeTotals(draft, full, admin).margin?.totalBps).toBe(5000);
    const bump = {
      ...draft,
      people: draft.people.map((p) =>
        p.email === 'cai@x.test'
          ? { ...p, coMargin: { on: true, percentage: '80' } }
          : p,
      ),
    };
    expect(computeTotals(bump, full, admin).margin?.exceeds).toBe(true);
    expect(validateDraft(bump, full, admin)).toMatch(/margem/i);
    // Bia vira coprodutora da margem: deixa de contar como afiliada.
    const both = {
      ...draft,
      people: draft.people.map((p) =>
        p.email === 'bia@x.test'
          ? { ...p, coMargin: { on: true, percentage: '10' } }
          : p,
      ),
    };
    expect(computeTotals(both, full, admin).margin).toMatchObject({
      coproducersBps: 3000,
      affiliateBps: 0,
    });
  });

  test('margem herdada soma na oferta e a oferta vence a mesma pessoa', () => {
    const offer: ParticipationsContext = { ...admin, platform: false };
    const agreements: Agreements = {
      co,
      aff: { ...aff, inherited: undefined },
      margin: {
        ...margin,
        inherited: {
          defaultPercentageBps: null,
          commissionOnRenewals: true,
          affiliates: [],
          coproducers: [
            { name: 'Cai', percentageBps: 4000 },
            { name: 'Zed', percentageBps: 1000 },
          ],
        },
      },
    };
    const draft = buildDraft(agreements, offer);
    // Cai (oferta, 20%) vence o 40% herdado; Zed 10% soma; afiliado Bia 30%.
    expect(computeTotals(draft, agreements, offer).margin).toMatchObject({
      coproducersBps: 3000,
      affiliateBps: 3000,
    });
  });
});
