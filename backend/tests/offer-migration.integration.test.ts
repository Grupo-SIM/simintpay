import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  applyPlan,
  buildPlan,
  parseArgs,
  verify,
} from '../scripts/offer-migration-apply';

const url = process.env.OFFER_MIGRATION_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;

let sellerA: string;
let sellerB: string;
let adminId: string;

async function legacySnapshot() {
  const d = db!;
  return JSON.stringify([
    await d.paymentLink.findMany({ orderBy: { id: 'asc' } }),
    await d.subscriptionLink.findMany({ orderBy: { id: 'asc' } }),
    await d.plan.findMany({ orderBy: { id: 'asc' } }),
    await d.pixCreditPlan.findMany({ orderBy: { id: 'asc' } }),
    await d.pixPlanLinkCode.findMany({ orderBy: { id: 'asc' } }),
    await d.boleto.findMany({ orderBy: { id: 'asc' } }),
  ]);
}

beforeAll(async () => {
  if (!db) return;
  await db.acquirerCatalogue.upsert({
    where: { code: 'DOM' },
    update: {},
    create: { code: 'DOM', name: 'DOM' },
  });
  const user = (role: 'USER' | 'ADMIN') =>
    db.user.create({
      data: {
        name: role,
        email: `${role}-${crypto.randomUUID()}@test.dev`,
        password: 'x',
        role,
      },
    });
  sellerA = (await user('USER')).id;
  sellerB = (await user('USER')).id;
  adminId = (await user('ADMIN')).id;

  await db.paymentLink.createMany({
    data: [
      {
        id: 'pl-ok',
        userId: sellerA,
        code: 'PL-OK',
        title: 'Link',
        amount: '49.90',
        domPaymentLinkId: 'dom-pl-1',
        plataformas: ['PAGATG'],
      },
      {
        id: 'pl-low',
        userId: sellerA,
        code: 'PL-LOW',
        title: 'Sub-minimum',
        amount: '5.00',
        plataformas: [],
      },
      {
        id: 'pl-admin',
        userId: adminId,
        code: 'PL-ADMIN',
        title: 'Admin owned',
        amount: '99.00',
      },
      {
        id: 'pl-hook',
        userId: sellerA,
        code: 'PL-HOOK',
        title: 'With delivery',
        amount: '97.00',
        redirectUrl: 'https://example.com/obrigado',
        emailBody: 'Obrigado pela compra',
        platformFee1x: 5,
      },
      {
        id: 'pl-funnel',
        userId: sellerA,
        code: 'PL-FUNNEL',
        title: 'With bump',
        amount: '97.00',
      },
      {
        id: 'pl-badhook',
        userId: sellerA,
        code: 'PL-BADHOOK',
        title: 'Internal webhook',
        amount: '97.00',
        redirectUrl: 'http://10.0.0.5/hook',
      },
      {
        id: 'pl-dup',
        userId: sellerA,
        code: 'SHARED',
        title: 'Dup A',
        amount: '20.00',
      },
    ],
  });
  await db.paymentLinkOffer.create({
    data: {
      paymentLinkId: 'pl-funnel',
      type: 'ORDER_BUMP',
      title: 'Bump',
      price: '19.90',
    },
  });
  await db.subscriptionLink.createMany({
    data: [
      {
        id: 'sl-live',
        userId: sellerB,
        code: 'SL-LIVE',
        name: 'Assinatura viva',
        amount: '29.90',
        frequencyType: 'MONTHLY',
      },
      {
        id: 'sl-ok',
        userId: sellerB,
        code: 'SL-OK',
        name: 'Assinatura',
        amount: '29.90',
        frequencyType: 'ANUAL',
        domPlanId: 'dom-plan-1',
      },
      {
        id: 'sl-dup',
        userId: sellerB,
        code: 'SHARED',
        name: 'Dup B',
        amount: '20.00',
        frequencyType: 'MONTHLY',
      },
    ],
  });
  await db.subscriptionLinkOrder.create({
    data: {
      subscriptionLinkId: 'sl-live',
      userId: sellerB,
      customerName: 'Buyer',
      customerEmail: 'buyer@test.dev',
      customerDocument: '00000000000',
      amountCharged: '29.90',
      status: 'active',
      domSubscriptionId: 'dom-sub-live',
    },
  });
  await db.plan.createMany({
    data: [
      {
        id: 'plan-ok',
        userId: sellerA,
        code: 'PLAN-OK',
        name: 'Plano',
        price: '59.90',
        type: 'MONTHLY',
        frequency: 2,
        domPlanId: 'dom-plan-2',
      },
      {
        id: 'plan-nocode',
        userId: sellerA,
        name: 'Sem codigo',
        price: '59.90',
        type: 'MONTHLY',
      },
    ],
  });
  await db.pixCreditPlan.createMany({
    data: [
      { id: 'px-ok', userId: sellerB, type: 'MONTHLY', price: 19.9 },
      { id: 'px-nocode', userId: sellerB, type: 'MONTHLY', price: 19.9 },
    ],
  });
  await db.pixPlanLinkCode.createMany({
    data: [
      {
        code: 'PX-INACTIVE',
        pixCreditPlanId: 'px-ok',
        isActive: false,
        createdAt: new Date('2025-01-01'),
      },
      {
        code: 'PX-OLDEST',
        pixCreditPlanId: 'px-ok',
        createdAt: new Date('2025-02-01'),
      },
      {
        code: 'PX-NEWER',
        pixCreditPlanId: 'px-ok',
        createdAt: new Date('2025-03-01'),
      },
    ],
  });
  await db.boleto.create({
    data: {
      id: 'bol-ok',
      userId: sellerA,
      code: 'BOL-OK',
      title: 'Boleto',
      amount: '150.00',
      vencimentoDias: 7,
      redirectUrl: 'https://example.com/boleto',
      domPaymentLinkId: 'dom-pl-2',
    },
  });
});
afterAll(async () => {
  await db?.$disconnect();
});

test('CLI refuses unsafe invocations', () => {
  expect(() => parseArgs([])).toThrow('--database-url');
  expect(() => parseArgs(['--apply', '--database-url=x'])).toThrow(
    '--i-understand-this-writes',
  );
  expect(() =>
    parseArgs([
      '--apply',
      '--verify',
      '--i-understand-this-writes',
      '--database-url=x',
    ]),
  ).toThrow('mutually exclusive');
  expect(parseArgs(['--database-url=postgresql://h/d']).apply).toBe(false);
  expect(parseArgs(['--database-url=postgresql://h/d'])).toMatchObject({
    includeBoleto: false,
    allowBlocked: false,
  });
  expect(
    parseArgs(['--database-url=x', '--include-boleto', '--allow-blocked']),
  ).toMatchObject({ includeBoleto: true, allowBlocked: true });
});

run('dry run classifies rows and writes nothing', async () => {
  const before = await legacySnapshot();
  const plan = await buildPlan(db!);
  const status = Object.fromEntries(
    plan.decisions.map((d) => [d.candidate.draft.legacyId, d.status]),
  );
  expect(status).toMatchObject({
    'pl-ok': 'CREATE',
    'pl-low': 'CREATE',
    'pl-admin': 'BLOCKED_ADMIN_OWNER',
    'pl-dup': 'REFUSED',
    'pl-hook': 'CREATE',
    'pl-funnel': 'BLOCKED',
    'pl-badhook': 'REFUSED',
    'sl-live': 'BLOCKED',
    'sl-ok': 'CREATE',
    'sl-dup': 'REFUSED',
    'plan-ok': 'CREATE',
    'plan-nocode': 'REFUSED',
    'px-ok': 'CREATE',
    'px-nocode': 'REFUSED',
    'bol-ok': 'BLOCKED',
  });
  const decision = (id: string) =>
    plan.decisions.find((d) => d.candidate.draft.legacyId === id)!;
  expect(decision('pl-funnel').reasons.join()).toContain(
    'BLOCKED_HAS_FUNNEL_OFFERS',
  );
  expect(decision('sl-live').reasons.join()).toContain(
    'BLOCKED_LIVE_DOM_SUBSCRIPTION',
  );
  expect(decision('sl-live').reasons.join()).not.toContain('buyer@');
  expect(decision('bol-ok').reasons.join()).toContain(
    'BLOCKED_BOLETO_CHARGE_UNSUPPORTED',
  );
  expect(decision('pl-badhook').reasons.join()).toContain(
    'INVALID_FULFILLMENT: redirectUrl',
  );
  expect(decision('pl-hook').warnings.join()).toContain(
    'FEE_OVERRIDE_NOT_CARRIED: platformFee1x',
  );
  expect(decision('pl-ok').warnings.join()).not.toContain('FEE_OVERRIDE');
  const withBoleto = await buildPlan(db!, { includeBoleto: true });
  expect(
    withBoleto.decisions.find((d) => d.candidate.draft.legacyId === 'bol-ok')!
      .status,
  ).toBe('CREATE');
  const low = plan.decisions.find(
    (d) => d.candidate.draft.legacyId === 'pl-low',
  )!;
  expect(low.warnings.join()).toContain('BELOW_MINIMUM_AMOUNT');
  expect(
    plan.decisions.find((d) => d.candidate.draft.legacyId === 'plan-nocode')!
      .reasons,
  ).toContain('MISSING_CODE');
  expect(await db!.offer.count()).toBe(0);
  expect(await legacySnapshot()).toBe(before);
});

run('apply creates offers and external refs, keeps legacy intact', async () => {
  const before = await legacySnapshot();
  const result = await applyPlan(db!, await buildPlan(db!));
  expect(result.created).toBe(6);
  expect(result.refs).toBe(3);
  expect(await legacySnapshot()).toBe(before);

  const offers = await db!.offer.findMany({ orderBy: { code: 'asc' } });
  expect(offers.map((o) => o.code)).toEqual([
    'PLAN-OK',
    'PL-HOOK',
    'PL-LOW',
    'PL-OK',
    'PX-OLDEST',
    'SL-OK',
  ]);
  const pl = offers.find((o) => o.code === 'PL-OK')!;
  expect(pl).toMatchObject({
    id: 'pl-ok',
    amountCents: 4990,
    ownerUserId: sellerA,
    platformTag: 'PAGATG',
  });
  expect(offers.find((o) => o.code === 'PL-LOW')!.platformTag).toBeNull();
  expect(offers.find((o) => o.code === 'PX-OLDEST')!.id).toBe('px-ok');
  expect(offers.find((o) => o.code === 'PLAN-OK')).toMatchObject({
    intervalType: 'MONTH',
    intervalCount: 2,
  });
  expect(offers.some((o) => o.ownerUserId === adminId)).toBe(false);
  expect(offers.find((o) => o.code === 'PL-HOOK')).toMatchObject({
    fulfillment: {
      redirectUrl: 'https://example.com/obrigado',
      emailBody: 'Obrigado pela compra',
    },
    metadata: null,
  });
  expect(offers.find((o) => o.code === 'PL-OK')!.fulfillment).toBeNull();
  expect(
    offers.some((o) => ['PL-FUNNEL', 'SL-LIVE', 'BOL-OK'].includes(o.code)),
  ).toBe(false);

  const refs = await db!.externalRef.findMany({
    where: { entityType: 'Offer' },
  });
  const ref = (kind: string, externalId: string) =>
    refs.find((r) => r.kind === kind && r.externalId === externalId);
  expect(ref('PAYMENT_LINK', 'dom-pl-1')?.entityId).toBe(pl.id);
  expect(ref('PLAN', 'dom-plan-1')).toBeDefined();
  expect(ref('PLAN', 'dom-plan-2')).toBeDefined();
  expect(ref('PAYMENT_LINK', 'dom-pl-2')).toBeUndefined();
  expect(refs.every((r) => r.acquirerCode === 'DOM')).toBe(true);
});

run(
  '--include-boleto migrates the boleto with due days and address flag',
  async () => {
    const options = { includeBoleto: true };
    const result = await applyPlan(db!, await buildPlan(db!, options));
    expect(result).toMatchObject({ created: 1, refs: 1 });
    const boleto = await db!.offer.findUniqueOrThrow({
      where: { code: 'BOL-OK' },
    });
    expect(boleto.metadata).toEqual({
      boletoDueDays: 7,
      requiresBuyerAddress: true,
    });
    expect(boleto.fulfillment).toEqual({
      redirectUrl: 'https://example.com/boleto',
    });
  },
);

run('apply is idempotent', async () => {
  const options = { includeBoleto: true };
  const again = await applyPlan(db!, await buildPlan(db!, options));
  expect(again).toMatchObject({ created: 0, refs: 0 });
  expect(await db!.offer.count()).toBe(7);
  const plan = await buildPlan(db!, options);
  expect(plan.decisions.filter((d) => d.status === 'CREATE')).toHaveLength(0);
});

run(
  'verify reports blocked products unless includeBoleto covers them',
  async () => {
    const problems = await verify(db!, { includeBoleto: true });
    expect(problems).toEqual([]);
    // Without the flag the boleto Offer has no eligible legacy row.
    expect((await verify(db!)).join('\n')).toContain(
      'Offer bol-ok has no eligible',
    );
  },
);

run('verify detects fulfillment and metadata mismatches', async () => {
  const options = { includeBoleto: true };
  await db!.offer.update({
    where: { code: 'PL-HOOK' },
    data: { fulfillment: { redirectUrl: 'https://evil.example.com/x' } },
  });
  await db!.offer.update({
    where: { code: 'BOL-OK' },
    data: { metadata: { boletoDueDays: 1, requiresBuyerAddress: true } },
  });
  const problems = (await verify(db!, options)).join('\n');
  expect(problems).toContain('PaymentLink:pl-hook: fulfillment');
  expect(problems).toContain('Boleto:bol-ok: metadata');
  await db!.offer.update({
    where: { code: 'PL-HOOK' },
    data: {
      fulfillment: {
        emailBody: 'Obrigado pela compra',
        redirectUrl: 'https://example.com/obrigado',
      },
    },
  });
  await db!.offer.update({
    where: { code: 'BOL-OK' },
    data: { metadata: { requiresBuyerAddress: true, boletoDueDays: 7 } },
  });
  expect(await verify(db!, options)).toEqual([]);
});

run('verify passes, then reports tampering', async () => {
  expect(await verify(db!, { includeBoleto: true })).toEqual([]);

  await db!.offer.update({
    where: { code: 'PL-OK' },
    data: { amountCents: 1 },
  });
  await db!.offer.update({
    where: { code: 'BOL-OK' },
    data: { ownerUserId: sellerB },
  });
  const problems = await verify(db!, { includeBoleto: true });
  expect(problems.join('\n')).toContain('PaymentLink:pl-ok: amountCents 1');
  expect(problems.join('\n')).toContain('Boleto:bol-ok: owner');

  await db!.offer.deleteMany({ where: { code: 'SL-OK' } });
  expect((await verify(db!, { includeBoleto: true })).join('\n')).toContain(
    'SubscriptionLink:sl-ok',
  );
});

run('rollback by id leaves legacy rows untouched', async () => {
  const before = await legacySnapshot();
  await db!.externalRef.deleteMany({ where: { entityType: 'Offer' } });
  await db!.offer.deleteMany();
  expect(await db!.offer.count()).toBe(0);
  expect(await legacySnapshot()).toBe(before);
});

run('an Offer holding a legacy id with another code refuses it', async () => {
  await db!.offer.create({
    data: {
      id: 'pl-ok',
      ownerUserId: sellerB,
      createdByUserId: sellerB,
      code: 'FOREIGN',
      kind: 'PAYMENT_LINK',
      name: 'Foreign',
      amountCents: 5000,
      acceptedMethods: ['PIX'],
    } as never,
  });
  const plan = await buildPlan(db!);
  const d = plan.decisions.find((x) => x.candidate.draft.legacyId === 'pl-ok')!;
  expect(d.status).toBe('REFUSED');
  expect(d.reasons.join()).toContain('ID_COLLISION');
  await db!.offer.delete({ where: { id: 'pl-ok' } });
});
