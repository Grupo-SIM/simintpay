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
const base = { ...formFromPreset('ONE_TIME'), name: 'X' };

describe('presets', () => {
  test('modelo de boleto preenche só o meio de pagamento', () => {
    const form = formFromPreset('BOLETO');
    expect(form.methods).toEqual(['BOLETO']);
    expect(form.renewalMode).toBe('NONE');
  });

  test('aplicar modelo mantém nome, valor e entrega', () => {
    const form = {
      ...base,
      name: 'Curso',
      amount: '99,90',
    };
    const next = applyPreset(form, 'CARD_SUBSCRIPTION');
    expect(next).toMatchObject({
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
    expect(validateOfferForm(base, 0)).toBe('Informe o valor da oferta.');
    expect(validateOfferForm(base, 0.01)).toBeNull();
    expect(validateOfferForm({ ...base, methods: [] }, 50)).toMatch(/forma/);
    expect(
      validateOfferForm(
        { ...base, methods: ['PIX'], maxInstallments: '3' },
        50,
      ),
    ).toBeNull();
    expect(validateOfferForm({ ...base, maxInstallments: '13' }, 50)).toMatch(
      /1x e 12x/,
    );
  });

  test('recorrência: intervalo, repetições e dias', () => {
    const rec = { ...formFromPreset('CARD_SUBSCRIPTION'), name: 'C' };
    expect(validateOfferForm(rec, 50)).toBeNull();
    expect(validateOfferForm({ ...rec, intervalCount: '0' }, 50)).toMatch(
      /intervalo/,
    );
    expect(validateOfferForm({ ...rec, trialDays: '-1' }, 50)).toMatch(/teste/);
    expect(validateOfferForm({ ...rec, graceDays: '1.5' }, 50)).toMatch(
      /carência/,
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
    const boleto = {
      ...base,
      methods: ['BOLETO' as const],
      maxInstallments: '1',
    };
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
  test('funil sem limites quantitativos, com upsell obrigatório para downsell', () => {
    let bumps: FormBump[] = [];
    for (let i = 0; i < 12; i++) {
      const r = addBump(bumps, `b${i}`, 'BUMP');
      if ('error' in r) throw new Error(r.error);
      bumps = r.bumps;
    }
    expect('bumps' in addBump(bumps, 'b12', 'BUMP')).toBe(true);
    expect(addBump([], 'd', 'DOWNSELL')).toEqual({
      error: 'O downsell exige um upsell configurado.',
    });
    const up = addBump([], 'u', 'UPSELL');
    if ('error' in up) throw new Error(up.error);
    expect('bumps' in addBump(up.bumps, 'u2', 'UPSELL')).toBe(true);
    expect(
      bumpsProblem([
        ...up.bumps,
        { offerId: 'd1', role: 'DOWNSELL' },
        { offerId: 'd2', role: 'DOWNSELL' },
      ]),
    ).toBeNull();
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
  test('criação de compra única: plataforma, sem intervalo nem nulos', () => {
    const form = { ...base, name: ' Mentoria ' };
    const created = offerPayload(form, 99.9, { platformTag: 'GLOBAL' });
    expect(created).toMatchObject({
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
    ])
      expect(key in created).toBe(false);
    expect('platformTag' in offerPayload(form, 99.9)).toBe(false);
    expect('kind' in created).toBe(false);
  });

  test('recorrente envia intervalo, repetições e dias', () => {
    const form = {
      ...formFromPreset('CARD_SUBSCRIPTION'),
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
        metadata: { other: 1, boletoDueDays: 9, requiresBuyerAddress: true },
      },
    };
    expect(offerPayload(edited, 50).metadata).toEqual({ other: 1 });
  });

  test('edição limpa campos vazios com null (e repetições com 0)', () => {
    const payload = offerPayload(
      { ...formFromPreset('CARD_SUBSCRIPTION'), name: 'C' },
      50,
    );
    expect(payload).toMatchObject({
      repetitions: 0,
      trialDays: null,
      retryDays: null,
      graceDays: null,
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
      expiresAt: null,
      maxUses: 5,
      fulfillment: {
        redirectUrl: 'https://a.com',
        emailBody: 'oi',
        files: [{ fileName: 'a', fileUrl: 'https://s/a' }],
        bumps: [{ offerId: 'x', role: 'UPSELL' }],
      },
      metadata: { boletoDueDays: 4, requiresBuyerAddress: true, custom: true },
    } as unknown as Offer;
    const form = formFromOffer(offer, fmt);
    expect(form).toMatchObject({
      amount: '49,90',
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
    };
    expect(fulfillment.files).toHaveLength(1);
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
    const rec = formFromPreset('CARD_SUBSCRIPTION');
    expect(renewalModeOf(rec)).toBe('AUTO_CHARGE');
    expect(renewalModeOf({ ...rec, methods: ['PIX'] })).toBe('MANUAL_PAY');
    expect(renewalModeOf({ ...rec, methods: ['PIX', 'CREDIT_CARD'] })).toBe(
      'AUTO_CHARGE',
    );
    expect(renewalModeOf({ ...rec, renewalMode: 'NONE' })).toBe('NONE');
  });
});
