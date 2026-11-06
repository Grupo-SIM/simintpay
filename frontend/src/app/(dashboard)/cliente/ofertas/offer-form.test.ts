import { describe, expect, test } from 'bun:test';
import {
  addBump,
  applyPreset,
  bumpCandidates,
  bumpsProblem,
  formFromOffer,
  formFromPreset,
  offerPayload,
  removeBump,
  renewalModeOf,
  toDateInput,
  unsafeUrlReason,
  validateOfferForm,
  type FormBump,
} from './offer-form';
import type { Offer } from './offers';

const fmt = (v: number) => v.toFixed(2).replace('.', ',');
const base = { ...formFromPreset('PAYMENT_LINK'), name: 'X' };

describe('presets', () => {
  test('PIX_PLAN preenche recorrência manual e dias de acesso', () => {
    const form = formFromPreset('PIX_PLAN');
    expect(form.methods).toEqual(['PIX']);
    expect(form.renewalMode).toBe('MANUAL_PAY');
    expect(form.accessDays).toBe('30');
  });

  test('aplicar modelo mantém nome, valor e entrega', () => {
    const form = {
      ...base,
      name: 'Curso',
      amount: '99,90',
    };
    const next = applyPreset(form, 'SUBSCRIPTION_LINK');
    expect(next).toMatchObject({
      kind: 'SUBSCRIPTION_LINK',
      name: 'Curso',
      amount: '99,90',
      renewalMode: 'AUTO_CHARGE',
      methods: ['CREDIT_CARD', 'DEBIT_CARD'],
    });
  });
});

describe('validateOfferForm (espelha offer.validator.ts)', () => {
  test('nome, valor mínimo, meios, parcelas e cartão automático', () => {
    expect(validateOfferForm({ ...base, name: ' ' }, 50)).toMatch(/nome/);
    expect(validateOfferForm(base, 14.98)).toBe('O valor mínimo é R$ 14,99');
    expect(validateOfferForm(base, 14.99)).toBeNull();
    expect(validateOfferForm({ ...base, methods: [] }, 50)).toMatch(/forma/);
    expect(
      validateOfferForm(
        { ...base, methods: ['PIX'], maxInstallments: '3' },
        50,
      ),
    ).toMatch(/crédito/);
    expect(validateOfferForm({ ...base, maxInstallments: '13' }, 50)).toMatch(
      /1x e 12x/,
    );
  });

  test('recorrência: intervalo, repetições e dias', () => {
    const rec = { ...formFromPreset('SUBSCRIPTION_LINK'), name: 'C' };
    expect(validateOfferForm(rec, 50)).toBeNull();
    expect(validateOfferForm({ ...rec, intervalCount: '0' }, 50)).toMatch(
      /intervalo/,
    );
    expect(validateOfferForm({ ...rec, trialDays: '-1' }, 50)).toMatch(/teste/);
    expect(validateOfferForm({ ...rec, graceDays: '1.5' }, 50)).toMatch(
      /carência/,
    );
    expect(validateOfferForm({ ...base, accessDays: '0' }, 50)).toMatch(
      /acesso/,
    );
    expect(validateOfferForm({ ...base, maxUses: '0' }, 50)).toMatch(/usos/);
  });

  test('entrega: URLs seguras, bumps e boleto', () => {
    expect(
      validateOfferForm({ ...base, redirectUrl: 'http://localhost/x' }, 50),
    ).toMatch(/redirecionamento/);
    expect(
      validateOfferForm({ ...base, redirectUrl: 'ftp://a.com' }, 50),
    ).toMatch(/redirecionamento/);
    expect(
      validateOfferForm({ ...base, redirectUrl: 'https://a.com/obrigado' }, 50),
    ).toBeNull();
    expect(
      validateOfferForm(
        { ...base, bumps: [{ offerId: 'a', role: 'DOWNSELL' }] },
        50,
      ),
    ).toMatch(/upsell/);
    const boleto = { ...base, methods: ['BOLETO' as const] };
    expect(validateOfferForm({ ...boleto, boletoDueDays: '91' }, 50)).toMatch(
      /0 e 90/,
    );
    expect(
      validateOfferForm({ ...boleto, boletoDueDays: '90' }, 50),
    ).toBeNull();
    // Sem boleto o campo é ignorado.
    expect(validateOfferForm({ ...base, boletoDueDays: '500' }, 50)).toBeNull();
  });
});

describe('unsafeUrlReason', () => {
  test.each([
    ['not a url', 'URL inválida'],
    ['ftp://a.com', 'Use uma URL http(s)'],
    ['https://u:p@a.com', 'A URL não pode conter credenciais'],
    ['http://intranet', 'Host não permitido'],
    ['http://app.internal', 'Host não permitido'],
    ['http://10.0.0.1/x', 'Endereço de rede interna não permitido'],
    ['http://169.254.169.254', 'Endereço de rede interna não permitido'],
    ['http://[::1]/', 'Endereço de rede interna não permitido'],
  ])('%s', (url, reason) => {
    expect(unsafeUrlReason(url)).toBe(reason);
  });
  test('aceita host público', () => {
    expect(unsafeUrlReason('https://hooks.example.com/x?y=1')).toBeNull();
    expect(unsafeUrlReason('http://8.8.8.8/x')).toBeNull();
  });
});

describe('bumps', () => {
  test('limites: 5 bumps, 1 upsell, 1 downsell que exige upsell', () => {
    let bumps: FormBump[] = [];
    for (let i = 0; i < 5; i++) {
      const r = addBump(bumps, `b${i}`, 'BUMP');
      if ('error' in r) throw new Error(r.error);
      bumps = r.bumps;
    }
    expect(addBump(bumps, 'b5', 'BUMP')).toEqual({
      error: 'Máximo de 5 order bumps.',
    });
    expect(addBump([], 'd', 'DOWNSELL')).toEqual({
      error: 'O downsell exige um upsell configurado.',
    });
    const up = addBump([], 'u', 'UPSELL');
    if ('error' in up) throw new Error(up.error);
    expect(addBump(up.bumps, 'u2', 'UPSELL')).toEqual({
      error: 'Apenas 1 upsell por oferta.',
    });
    expect('bumps' in addBump(up.bumps, 'd', 'DOWNSELL')).toBe(true);
    expect(
      bumpsProblem([
        { offerId: 'a', role: 'BUMP' },
        { offerId: 'a', role: 'UPSELL' },
      ]),
    ).toBe('Oferta repetida em bumps.');
    expect(removeBump(up.bumps, 'u')).toEqual([]);
  });

  test('candidatos: só avulsas ativas, sem a própria nem as já escolhidas', () => {
    const o = (id: string, extra: Partial<Offer> = {}) =>
      ({ id, isActive: true, renewalMode: 'NONE', ...extra }) as Offer;
    const list = [
      o('a'),
      o('self'),
      o('off', { isActive: false }),
      o('rec', { renewalMode: 'AUTO_CHARGE' }),
      o('taken'),
    ];
    expect(
      bumpCandidates(list, 'self', [{ offerId: 'taken', role: 'BUMP' }]).map(
        (x) => x.id,
      ),
    ).toEqual(['a']);
  });
});

describe('offerPayload', () => {
  test('criação de compra única: kind/plataforma, sem intervalo nem nulos', () => {
    const form = { ...base, name: ' Mentoria ' };
    const created = offerPayload(form, 99.9, { platformTag: 'GLOBAL' });
    expect(created).toMatchObject({
      kind: 'PAYMENT_LINK',
      platformTag: 'GLOBAL',
      name: 'Mentoria',
      amountCents: 9990,
      renewalMode: 'NONE',
    });
    for (const key of [
      'intervalType',
      'fulfillment',
      'metadata',
      'description',
      'expiresAt',
      'maxUses',
      'accessDays',
    ])
      expect(key in created).toBe(false);
    expect('kind' in offerPayload(form, 99.9)).toBe(false);
  });

  test('recorrente envia intervalo, repetições e dias', () => {
    const form = {
      ...formFromPreset('SUBSCRIPTION_LINK'),
      name: 'Clube',
      repetitions: '12',
      trialDays: '7',
      retryDays: '2',
      graceDays: '3',
    };
    expect(offerPayload(form, 29.9, { platformTag: 'G' })).toMatchObject({
      renewalMode: 'AUTO_CHARGE',
      intervalType: 'MONTH',
      intervalCount: 1,
      repetitions: 12,
      trialDays: 7,
      retryDays: 2,
      graceDays: 3,
    });
  });

  test('entrega: só envia o que foi preenchido na criação, nunca arquivos novos', () => {
    const form = {
      ...base,
      redirectUrl: ' https://a.com/h ',
      bumps: [{ offerId: 'o1', role: 'BUMP' as const }],
    };
    const payload = offerPayload(form, 50, { platformTag: 'G' });
    expect(payload.fulfillment).toEqual({
      emailBody: '',
      redirectUrl: 'https://a.com/h',
      bumps: [{ offerId: 'o1', role: 'BUMP' }],
      files: [],
    });
  });

  test('boleto grava vencimento e flag de endereço; sem boleto remove as chaves', () => {
    const boleto = {
      ...base,
      methods: ['BOLETO' as const],
      boletoDueDays: '5',
    };
    expect(offerPayload(boleto, 50, { platformTag: 'G' }).metadata).toEqual({
      boletoDueDays: 5,
      requiresBuyerAddress: true,
    });
    const edited = {
      ...base,
      keep: {
        files: [],
        communityId: null,
        metadata: { other: 1, boletoDueDays: 9, requiresBuyerAddress: true },
      },
    };
    expect(offerPayload(edited, 50).metadata).toEqual({ other: 1 });
  });

  test('edição limpa campos vazios com null (e repetições com 0)', () => {
    const payload = offerPayload(
      { ...formFromPreset('SUBSCRIPTION_LINK'), name: 'C' },
      50,
    );
    expect(payload).toMatchObject({
      repetitions: 0,
      trialDays: null,
      retryDays: null,
      graceDays: null,
      accessDays: null,
      expiresAt: null,
      maxUses: null,
      metadata: {},
    });
    expect((payload.fulfillment as { bumps: unknown[] }).bumps).toEqual([]);
  });

  test('validade vira ISO ao fim do dia local', () => {
    const payload = offerPayload({ ...base, expiresAt: '2026-12-31' }, 50, {
      platformTag: 'G',
    });
    expect(new Date(payload.expiresAt as string).getTime()).toBe(
      new Date('2026-12-31T23:59:59').getTime(),
    );
  });
});

describe('formFromOffer', () => {
  test('hidrata entrega, bumps, boleto e preserva arquivos e metadata desconhecido', () => {
    const offer = {
      kind: 'PLAN',
      name: 'N',
      description: null,
      amountCents: 4990,
      acceptedMethods: ['BOLETO', 'PIX'],
      maxInstallments: 1,
      renewalMode: 'NONE',
      intervalType: null,
      intervalCount: null,
      repetitions: null,
      trialDays: null,
      retryDays: null,
      graceDays: null,
      accessDays: 30,
      expiresAt: null,
      maxUses: 5,
      fulfillment: {
        redirectUrl: 'https://a.com',
        emailBody: 'oi',
        files: [{ fileName: 'a', fileUrl: 'https://s/a' }],
        communityId: 'c1',
        bumps: [{ offerId: 'x', role: 'UPSELL' }],
      },
      metadata: { boletoDueDays: 4, requiresBuyerAddress: true, custom: true },
    } as unknown as Offer;
    const form = formFromOffer(offer, fmt);
    expect(form).toMatchObject({
      amount: '49,90',
      accessDays: '30',
      maxUses: '5',
      redirectUrl: 'https://a.com',
      emailBody: 'oi',
      boletoDueDays: '4',
      bumps: [{ offerId: 'x', role: 'UPSELL' }],
    });
    expect(form.keep.files).toHaveLength(1);
    const payload = offerPayload(form, 49.9);
    const fulfillment = payload.fulfillment as {
      files: unknown[];
      communityId: string;
    };
    expect(fulfillment.files).toHaveLength(1);
    expect(fulfillment.communityId).toBe('c1');
    expect(payload.metadata).toEqual({
      custom: true,
      boletoDueDays: 4,
      requiresBuyerAddress: true,
    });
  });

  test('data de validade usa o dia local', () => {
    expect(toDateInput(null)).toBe('');
    expect(toDateInput('lixo')).toBe('');
    const local = new Date(2026, 11, 31, 23, 59, 59).toISOString();
    expect(toDateInput(local)).toBe('2026-12-31');
  });
});

describe('renewalModeOf', () => {
  test('deriva o modo de renovação dos meios aceitos', () => {
    const rec = formFromPreset('SUBSCRIPTION_LINK');
    expect(renewalModeOf(rec)).toBe('AUTO_CHARGE');
    expect(renewalModeOf({ ...rec, methods: ['PIX'] })).toBe('MANUAL_PAY');
    expect(renewalModeOf({ ...rec, methods: ['PIX', 'CREDIT_CARD'] })).toBe(
      'AUTO_CHARGE',
    );
    expect(renewalModeOf({ ...rec, renewalMode: 'NONE' })).toBe('NONE');
  });
});
