import { expect, test } from 'bun:test';
import {
  mapBoleto,
  mapPaymentLink,
  mapPixCreditPlan,
  mapPlan,
  mapSubscriptionLink,
  toCents,
} from './legacy-offer-mapper';

test('toCents is exact and rejects sub-cent or malformed values', () => {
  expect(toCents('19.90')).toBe(1990);
  expect(toCents(19.9)).toBe(1990);
  expect(toCents('0.29')).toBe(29);
  expect(toCents(1.15)).toBe(115);
  expect(toCents({ toString: () => '1234.5' })).toBe(123450);
  expect(toCents('10')).toBe(1000);
  expect(toCents('10.000')).toBe(1000);
  expect(toCents('10.001')).toBeNull();
  expect(toCents('1e5')).toBeNull();
  expect(toCents(null)).toBeNull();
  expect(toCents('abc')).toBeNull();
});

test('PaymentLink maps methods, usage and keeps the code', () => {
  const d = mapPaymentLink({
    id: 'p1',
    userId: 'u1',
    createdByUserId: 'admin',
    code: 'abc',
    title: 'Curso',
    amount: '99.99',
    aceitaCartao: true,
    aceitaDebito: false,
    aceitaPix: true,
    maxInstallments: 6,
    maxUses: 10,
    currentUses: 3,
    plataformas: ['AREAFLIX', 'PAGATG'],
  });
  expect(d).toMatchObject({
    ownerUserId: 'u1',
    createdByUserId: 'admin',
    platformTag: 'AREAFLIX',
    code: 'abc',
    amountCents: 9999,
    acceptedMethods: ['CREDIT_CARD', 'PIX'],
    maxInstallments: 6,
    maxUses: 10,
    usedCount: 3,
    renewalMode: 'NONE',
    legacyType: 'PaymentLink',
    legacyId: 'p1',
    issues: [],
  });
});

test('PaymentLink null fields fall back and flag issues', () => {
  const d = mapPaymentLink({
    id: 'p2',
    userId: null,
    title: 'x',
    amount: null,
    code: ' ',
    plataformas: [],
  });
  expect(d.platformTag).toBeNull();
  expect(d.createdByUserId).toBeNull();
  expect(d.acceptedMethods).toEqual(['CREDIT_CARD', 'DEBIT_CARD', 'PIX']);
  expect(d.maxInstallments).toBe(1);
  expect(d.usedCount).toBe(0);
  expect(d.issues).toEqual(['INVALID_AMOUNT', 'MISSING_CODE', 'MISSING_OWNER']);
});

test('createdByUserId defaults to the owner', () => {
  const d = mapBoleto({
    id: 'b',
    userId: 'u',
    title: 't',
    amount: '5',
    code: 'c',
  });
  expect(d.createdByUserId).toBe('u');
});

test('SubscriptionLink ANUAL is yearly, auto charge, 365 days', () => {
  const d = mapSubscriptionLink({
    id: 's1',
    userId: 'u1',
    code: 'sub',
    name: 'Anual',
    amount: '1499.00',
    frequencyType: 'ANUAL',
    paymentMethods: 'BOTH',
    platformTag: 'GLOBAL',
    plataformas: [],
  });
  expect(d).toMatchObject({
    renewalMode: 'AUTO_CHARGE',
    intervalType: 'YEAR',
    intervalCount: 1,
    amountCents: 149900,
    acceptedMethods: ['CREDIT_CARD', 'PIX'],
    platformTag: 'GLOBAL',
  });
});

test('SubscriptionLink PIX-only and TRIMESTRAL', () => {
  const d = mapSubscriptionLink({
    id: 's2',
    userId: 'u1',
    code: 'c',
    name: 'T',
    amount: '30',
    frequencyType: 'TRIMESTRAL',
    paymentMethods: 'PIX',
  });
  expect(d.acceptedMethods).toEqual(['PIX']);
  expect(d).toMatchObject({
    intervalType: 'MONTH',
    intervalCount: 3,
  });
});

test('Plan keeps repetitions, retryDays and tolerates null code/methods', () => {
  const d = mapPlan({
    id: 'pl',
    userId: 'u',
    name: 'Plano',
    price: '49.90',
    type: 'MONTHLY',
    repetitions: 12,
    retryDays: 3,
    code: null,
    paymentMethods: null,
    plataformas: ['BOSQUE'],
  });
  expect(d).toMatchObject({
    renewalMode: 'AUTO_CHARGE',
    repetitions: 12,
    retryDays: 3,
    intervalType: 'MONTH',
    intervalCount: 1,
    acceptedMethods: ['CREDIT_CARD', 'PIX'],
    platformTag: 'BOSQUE',
  });
  expect(d.issues).toEqual(['MISSING_CODE']);
});

test('Plan SEMESTRAL and WEEKLY', () => {
  expect(
    mapPlan({ id: 'a', userId: 'u', name: 'n', price: 1, type: 'SEMESTRAL' }),
  ).toMatchObject({ intervalType: 'MONTH', intervalCount: 6 });
  expect(
    mapPlan({ id: 'b', userId: 'u', name: 'n', price: 1, type: 'WEEKLY' }),
  ).toMatchObject({ intervalType: 'WEEK' });
});

test('PixCreditPlan is PIX manual pay and float price has no drift', () => {
  const d = mapPixCreditPlan({
    id: 'x',
    userId: 'u',
    type: 'MONTHLY',
    price: 19.99,
    status: 'INACTIVE',
    tenantTag: 'RENOVADA',
  });
  expect(d).toMatchObject({
    renewalMode: 'MANUAL_PAY',
    acceptedMethods: ['PIX'],
    amountCents: 1999,
    isActive: false,
    platformTag: 'RENOVADA',
    code: null,
  });
  expect(d.name).toBe('PIX MONTHLY');
  expect(d.issues).toEqual(['MISSING_CODE']);
});

test('PixCreditPlan takes the oldest active PixPlanLinkCode and notes the extras', () => {
  const d = mapPixCreditPlan({
    id: 'x',
    userId: 'u',
    type: 'MONTHLY',
    price: 10,
    linkCodes: [
      { code: 'PX-NEW', isActive: true, createdAt: new Date('2026-03-01') },
      {
        code: 'PX-OLDINACTIVE',
        isActive: false,
        createdAt: new Date('2025-01-01'),
      },
      { code: 'PX-OLD', isActive: true, createdAt: new Date('2026-01-01') },
    ],
  });
  expect(d.code).toBe('PX-OLD');
  expect(d.issues).toEqual([]);
  expect(d.notes).toEqual(['EXTRA_ACTIVE_LINK_CODES: PX-NEW']);
});

test('PixCreditPlan with only inactive codes still reports MISSING_CODE', () => {
  const d = mapPixCreditPlan({
    id: 'x',
    userId: 'u',
    price: 10,
    linkCodes: [{ code: 'PX-OFF', isActive: false }],
  });
  expect(d.code).toBeNull();
  expect(d.issues).toEqual(['MISSING_CODE']);
});

test('Plan.frequency multiplies the interval of type (gateway "every N units")', () => {
  const base = { id: 'f', userId: 'u', name: 'n', price: 1 };
  expect(mapPlan({ ...base, type: 'MONTHLY', frequency: 2 })).toMatchObject({
    intervalType: 'MONTH',
    intervalCount: 2,
  });
  expect(mapPlan({ ...base, type: 'WEEKLY', frequency: 3 })).toMatchObject({
    intervalType: 'WEEK',
    intervalCount: 3,
  });
  expect(mapPlan({ ...base, type: 'ANUAL', frequency: 2 })).toMatchObject({
    intervalType: 'YEAR',
    intervalCount: 2,
  });
  for (const frequency of [null, undefined, 1, 0, -1, 1.5])
    expect(mapPlan({ ...base, type: 'MONTHLY', frequency })).toMatchObject({
      intervalCount: 1,
    });
});

test('Boleto maps to BOLETO with no renewal', () => {
  const d = mapBoleto({
    id: 'b1',
    userId: 'u',
    code: 'bol',
    title: 'Boleto',
    amount: '150.10',
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    plataformas: ['SIMINTPAY'],
  });
  expect(d).toMatchObject({
    acceptedMethods: ['BOLETO'],
    renewalMode: 'NONE',
    amountCents: 15010,
    platformTag: 'SIMINTPAY',
    intervalType: null,
    issues: [],
  });
  expect(d.expiresAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
});

test('fulfillment carries only the non-empty webhook, redirect and email body', () => {
  const d = mapPaymentLink({
    id: 'f1',
    userId: 'u',
    code: 'c',
    title: 't',
    amount: '20.00',
    redirectUrl: ' https://example.com/obrigado ',
    emailBody: 'Obrigado',
  });
  expect(d.issues).toEqual([]);
  expect(d.fulfillment).toEqual({
    redirectUrl: 'https://example.com/obrigado',
    emailBody: 'Obrigado',
  });
  expect(
    mapPaymentLink({
      id: 'f2',
      userId: 'u',
      code: 'c',
      title: 't',
      amount: '20',
    }).fulfillment,
  ).toBeNull();
  const shared = {
    id: 'x',
    userId: 'u',
    code: 'c',
    redirectUrl: 'https://example.com/obrigado',
    webhookUrl: 'https://hooks.example.com/a',
  };
  const expected = {
    redirectUrl: 'https://example.com/obrigado',
  };
  expect(
    mapSubscriptionLink({ ...shared, name: 'n', amount: '20' }).fulfillment,
  ).toEqual(expected);
  expect(mapPlan({ ...shared, name: 'n', price: '20' }).fulfillment).toEqual(
    expected,
  );
  expect(
    mapPixCreditPlan({ ...shared, price: 20, linkCodes: [{ code: 'PX-1' }] })
      .fulfillment,
  ).toEqual(expected);
});

test('an unsafe redirect URL refuses the draft with the reason instead of dropping it', () => {
  const d = mapPaymentLink({
    id: 'f3',
    userId: 'u',
    code: 'c',
    title: 't',
    amount: '20.00',
    redirectUrl: 'http://127.0.0.1/hook',
  });
  expect(d.issues).toContain('INVALID_FULFILLMENT');
  expect(d.fulfillment).toBeNull();
  expect(d.issueDetails.join()).toContain('redirectUrl');
  const bad = mapPlan({
    id: 'f4',
    userId: 'u',
    code: 'c',
    name: 'n',
    price: '20',
    redirectUrl: 'ftp://example.com',
  });
  expect(bad.issues).toContain('INVALID_FULFILLMENT');
});

test('Boleto carries the due days and requires the buyer address', () => {
  const ok = mapBoleto({
    id: 'b1',
    userId: 'u',
    code: 'c',
    title: 't',
    amount: '150',
    vencimentoDias: 0,
    redirectUrl: 'https://example.com/boleto',
  });
  expect(ok.metadata).toEqual({ boletoDueDays: 0, requiresBuyerAddress: true });
  expect(ok.fulfillment).toEqual({
    redirectUrl: 'https://example.com/boleto',
  });
  expect(
    mapBoleto({ id: 'b2', userId: 'u', code: 'c', title: 't', amount: '1' })
      .metadata,
  ).toEqual({ boletoDueDays: 3, requiresBuyerAddress: true });
  const bad = mapBoleto({
    id: 'b3',
    userId: 'u',
    code: 'c',
    title: 't',
    amount: '1',
    vencimentoDias: 91,
  });
  expect(bad.issues).toContain('INVALID_BOLETO_DUE_DAYS');
  expect(bad.metadata).toBeNull();
});
