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
        id: 'pl-dup',
        userId: sellerA,
        code: 'SHARED',
        title: 'Dup A',
        amount: '20.00',
      },
    ],
  });
  await db.subscriptionLink.createMany({
    data: [
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
    'sl-ok': 'CREATE',
    'sl-dup': 'REFUSED',
    'plan-ok': 'CREATE',
    'plan-nocode': 'REFUSED',
    'px-ok': 'CREATE',
    'px-nocode': 'REFUSED',
    'bol-ok': 'CREATE',
  });
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
  expect(result.refs).toBe(4);
  expect(await legacySnapshot()).toBe(before);

  const offers = await db!.offer.findMany({ orderBy: { code: 'asc' } });
  expect(offers.map((o) => o.code)).toEqual([
    'BOL-OK',
    'PL-LOW',
    'PL-OK',
    'PLAN-OK',
    'PX-OLDEST',
    'SL-OK',
  ]);
  const pl = offers.find((o) => o.code === 'PL-OK')!;
  expect(pl).toMatchObject({
    amountCents: 4990,
    ownerUserId: sellerA,
    platformTag: 'PAGATG',
    legacyType: 'PaymentLink',
    legacyId: 'pl-ok',
  });
  expect(offers.find((o) => o.code === 'PL-LOW')!.platformTag).toBeNull();
  expect(offers.find((o) => o.code === 'PX-OLDEST')!.legacyId).toBe('px-ok');
  expect(offers.find((o) => o.code === 'PLAN-OK')).toMatchObject({
    intervalType: 'MONTH',
    intervalCount: 2,
  });
  expect(offers.some((o) => o.ownerUserId === adminId)).toBe(false);

  const refs = await db!.externalRef.findMany({
    where: { entityType: 'Offer' },
  });
  const ref = (kind: string, externalId: string) =>
    refs.find((r) => r.kind === kind && r.externalId === externalId);
  expect(ref('PAYMENT_LINK', 'dom-pl-1')?.entityId).toBe(pl.id);
  expect(ref('PLAN', 'dom-plan-1')).toBeDefined();
  expect(ref('PLAN', 'dom-plan-2')).toBeDefined();
  expect(ref('PAYMENT_LINK', 'dom-pl-2')).toBeDefined();
  expect(refs.every((r) => r.acquirerCode === 'DOM')).toBe(true);
});

run('apply is idempotent', async () => {
  const again = await applyPlan(db!, await buildPlan(db!));
  expect(again).toMatchObject({ created: 0, refs: 0 });
  expect(await db!.offer.count()).toBe(6);
  const plan = await buildPlan(db!);
  expect(plan.decisions.filter((d) => d.status === 'CREATE')).toHaveLength(0);
});

run('verify passes, then reports tampering', async () => {
  expect(await verify(db!)).toEqual([]);

  await db!.offer.update({
    where: { code: 'PL-OK' },
    data: { amountCents: 1 },
  });
  await db!.offer.update({
    where: { code: 'BOL-OK' },
    data: { ownerUserId: sellerB },
  });
  const problems = await verify(db!);
  expect(problems.join('\n')).toContain('PaymentLink:pl-ok: amountCents 1');
  expect(problems.join('\n')).toContain('Boleto:bol-ok: owner');

  await db!.offer.deleteMany({ where: { code: 'SL-OK' } });
  expect((await verify(db!)).join('\n')).toContain('SubscriptionLink:sl-ok');
});

run('rollback by legacyType leaves legacy rows untouched', async () => {
  const before = await legacySnapshot();
  await db!.externalRef.deleteMany({ where: { entityType: 'Offer' } });
  await db!.offer.deleteMany({ where: { legacyType: { not: null } } });
  expect(await db!.offer.count()).toBe(0);
  expect(await legacySnapshot()).toBe(before);
});
