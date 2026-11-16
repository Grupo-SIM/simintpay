import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { applyPlan, buildPlan } from '../scripts/offer-migration-apply';
import {
  applyDelta,
  buildDeltaPlan,
  conflictLines,
  verifyDelta,
} from '../scripts/offer-migration-delta';

const url = process.env.OFFER_MIGRATION_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;
const none = { skipActive: false, overwrite: new Set<string>() };

let seller: string;
const link = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: seller,
  code: `C-${id}`,
  title: id,
  amount: '100.00',
  ...over,
});

beforeAll(async () => {
  if (!db) return;
  seller = (
    await db.user.create({
      data: {
        name: 'S',
        email: `s-${crypto.randomUUID()}@test.dev`,
        password: 'x',
        role: 'USER',
      },
    })
  ).id;
  await db.paymentLink.createMany({
    data: [
      link('d-low'),
      link('d-sync'),
      link('d-uses'),
      link('d-off'),
      link('d-name'),
    ],
  });
  await db.subscriptionLink.create({
    data: {
      id: 'd-sub',
      userId: seller,
      code: 'C-d-sub',
      name: 'Sub',
      amount: '29.90',
      frequencyType: 'MONTHLY',
    },
  });
  // Phase 2: the owner copied the products.
  const plan = await buildPlan(db);
  await applyPlan(db, plan);
  // After the copy: coproduction written on the old key, legacy edits, a new link.
  const data = {
    product: 'links-pagamento',
    productId: 'd-sync',
    version: 1,
    participants: [{ userId: seller, percentageBps: 1000 }],
    actorId: seller,
  };
  await db.coproductionAgreement.create({ data });
  await db.coproductionRevision.create({ data });
  await new Promise((r) => setTimeout(r, 50));
  await db.paymentLink.update({
    where: { id: 'd-low' },
    data: { amount: '5.00' },
  });
  await db.paymentLink.update({
    where: { id: 'd-uses' },
    data: { currentUses: 3 },
  });
  await db.paymentLink.update({
    where: { id: 'd-off' },
    data: { isActive: false },
  });
  await db.paymentLink.update({
    where: { id: 'd-name' },
    data: { title: 'Renamed' },
  });
  await db.subscriptionLink.update({
    where: { id: 'd-sub' },
    data: { currentUses: 5 },
  });
  await db.offer.update({ where: { id: 'd-sub' }, data: { usedCount: 6 } });
  await db.paymentLink.create({ data: link('d-new') });
});
afterAll(async () => {
  await db?.$disconnect();
});

run('dry run reports the diffs and writes nothing', async () => {
  const before = JSON.stringify(
    await db!.offer.findMany({ orderBy: { id: 'asc' } }),
  );
  const dp = await buildDeltaPlan(db!, none);
  const diffs = Object.fromEntries(
    dp.products.map((p) => [
      p.legacyId,
      p.diffs.map((d) => `${d.field}:${d.resolution}`),
    ]),
  );
  expect(diffs['d-sync']).toEqual([]);
  expect(diffs['d-low']).toEqual(['amountCents:CONFLICT']);
  expect(diffs['d-uses']).toEqual(['usedCount:AUTO']);
  expect(diffs['d-off']).toEqual(['isActive:AUTO']);
  expect(diffs['d-name']).toEqual(['name:AUTO']);
  expect(diffs['d-sub']).toEqual(['usedCount:CONFLICT']);
  expect(dp.coproduction.map((c) => c.productId)).toEqual(['d-sync']);
  expect(
    dp.plan.decisions.find((d) => d.candidate.draft.legacyId === 'd-new')
      ?.status,
  ).toBe('CREATE');
  expect(conflictLines(dp).join('\n')).toContain('OFFER_AHEAD');
  expect(
    JSON.stringify(await db!.offer.findMany({ orderBy: { id: 'asc' } })),
  ).toBe(before);
  expect((await verifyDelta(db!, none)).length).toBeGreaterThan(0);
});

run(
  'apply copies the delta, keeps conflicts and re-keys coproduction',
  async () => {
    const dp = await buildDeltaPlan(db!, none);
    const result = await applyDelta(db!, dp);
    expect(result.created).toBe(1);
    expect(result.updatedOffers).toBe(3);
    expect(result.coproductionMoved).toBe(2);
    expect(result.unresolved.join('\n')).toContain('d-low amountCents');
    expect(result.unresolved.join('\n')).toContain('d-sub usedCount');
    const offer = (id: string) =>
      db!.offer.findUniqueOrThrow({ where: { id } });
    expect(await offer('d-new')).toMatchObject({ amountCents: 10000 });
    expect(await offer('d-uses')).toMatchObject({ usedCount: 3 });
    expect(await offer('d-off')).toMatchObject({ isActive: false });
    expect(await offer('d-name')).toMatchObject({ name: 'Renamed' });
    expect(await offer('d-low')).toMatchObject({ amountCents: 10000 });
    expect(await offer('d-sub')).toMatchObject({ usedCount: 6 });
    expect(
      await db!.coproductionAgreement.count({
        where: { product: 'links-pagamento' },
      }),
    ).toBe(0);
    expect(
      await db!.coproductionAgreement.count({
        where: { product: 'ofertas', productId: 'd-sync' },
      }),
    ).toBe(1);
    // a second run is a no-op for what was resolved
    const again = await applyDelta(db!, await buildDeltaPlan(db!, none));
    expect(again.created + again.updatedOffers + again.coproductionMoved).toBe(
      0,
    );
  },
);

run(
  'verify lists only what still diverges; explicit overwrite resolves usedCount',
  async () => {
    const problems = (await verifyDelta(db!, none)).join('\n');
    expect(problems).toContain('d-low');
    expect(problems).toContain('amountCents');
    expect(problems).toContain('d-sub');
    expect(problems).not.toContain('d-uses');
    const dp = await buildDeltaPlan(db!, {
      skipActive: false,
      overwrite: new Set(['d-sub', 'd-low']),
    });
    await applyDelta(db!, dp);
    expect(
      await db!.offer.findUniqueOrThrow({ where: { id: 'd-sub' } }),
    ).toMatchObject({ usedCount: 5 });
    // below the minimum still needs a human decision
    expect(
      await db!.offer.findUniqueOrThrow({ where: { id: 'd-low' } }),
    ).toMatchObject({ amountCents: 10000 });
    await db!.paymentLink.update({
      where: { id: 'd-low' },
      data: { amount: '100.00' },
    });
    expect(await verifyDelta(db!, none)).toEqual([]);
  },
);
