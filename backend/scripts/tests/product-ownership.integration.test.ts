import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { runAudit } from '../audit-product-ownership';
import { ReassignmentRejected, reassignProducts } from '../reassign-products';
import { PrismaPaymentLinkRepository } from '../../src/infrastructure/database/repositories/prisma-payment-link.repository';
import { mappingHash, type MappingEntry } from '../product-ownership';

const url = process.env.OWNERSHIP_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Tests require a local isolated database');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const pg = url ? new Client({ connectionString: url }) : null;
beforeAll(async () => {
  await pg?.connect();
});
afterAll(async () => {
  await pg?.end();
  await db?.$disconnect();
});
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 60000);

const id = () => crypto.randomUUID();
const user = (
  role: 'ADMIN' | 'USER' = 'USER',
  extra: Record<string, unknown> = {},
) =>
  db!.user.create({
    data: {
      email: `${id()}@local.test`,
      name: 'Local',
      password: 'x',
      role,
      cnpj:
        role === 'USER'
          ? id().replace(/\D/g, '').padEnd(14, '1').slice(0, 14)
          : null,
      ...extra,
    } as never,
  });
const tagOf = () => `T${id().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
const platform = (ownerUserId: string, tag = tagOf(), isActive = true) =>
  db!.platform.create({ data: { tag, name: tag, ownerUserId, isActive } });
const link = (userId: string, plataformas: string[] = []) =>
  db!.paymentLink.create({
    data: { userId, title: 'Prod', amount: 10, plataformas },
  });
const entry = (
  productId: string,
  newOwnerUserId: string,
  extra: Partial<MappingEntry> = {},
): MappingEntry => ({
  productType: 'PaymentLink',
  productId,
  newOwnerUserId,
  reason: 'approved in test',
  ...extra,
});
const audit = async () => (await runAudit(pg!, 'localhost')).products;
const find = async (productId: string) =>
  (await audit()).find((p) => p.productId === productId)!;
const ownerOf = async (productId: string) =>
  (await db!.paymentLink.findUniqueOrThrow({ where: { id: productId } }))
    .userId;

run(
  'classifies admin-owned products by registered platform owner only',
  async () => {
    const admin = await user('ADMIN'),
      owner = await user(),
      adminPlatformOwner = await user('ADMIN'),
      other = await user();
    const tag = (await platform(owner.id)).tag,
      adminTag = (await platform(adminPlatformOwner.id)).tag;
    const proposed = await find((await link(admin.id, [tag.toLowerCase()])).id);
    expect(proposed.classification).toEqual({
      status: 'PROPOSE_TRANSFER',
      targetUserId: owner.id,
      evidence: `Platform.ownerUserId of ${tag}`,
    });
    const adminPlatform = await find((await link(admin.id, [adminTag])).id);
    expect(adminPlatform.classification.status).toBe('NEEDS_DECISION');
    const noTag = await find((await link(admin.id)).id);
    expect(noTag.classification).toMatchObject({
      status: 'NEEDS_DECISION',
      reasons: expect.arrayContaining(['NO_PLATFORM_TAG']),
    });
    const unregistered = await find(
      (await link(admin.id, ['NOPE-UNREGISTERED'])).id,
    );
    expect(unregistered.classification.status).toBe('NEEDS_DECISION');
    const mismatch = await find((await link(other.id, [tag])).id);
    expect(mismatch.classification).toMatchObject({
      status: 'PROPOSE_TRANSFER',
      targetUserId: owner.id,
    });
    const ok = await find((await link(owner.id, [tag])).id);
    expect(ok.classification).toEqual({ status: 'OK' });
    const personal = await find((await link(owner.id)).id);
    expect(personal.classification.status).toBe('OK');
    expect(personal.warnings).toContain('NO_TAG');
    const multiple = await find((await link(admin.id, [tag, adminTag])).id);
    expect(multiple.classification).toMatchObject({
      status: 'NEEDS_DECISION',
      reasons: expect.arrayContaining(['MULTIPLE_TAGS']),
    });
  },
);

run(
  'flags missing documents, legacy ebook tag, coproduction admin participants and never writes',
  async () => {
    const admin = await user('ADMIN'),
      noDoc = await user('USER', { cnpj: null });
    const product = await link(noDoc.id, ['EBOOKSIM']);
    const row = await find(product.id);
    expect(row.warnings).toContain('OWNER_WITHOUT_CPF_CNPJ');
    expect(row.tags).toEqual(['EBOOK']);
    const owner = await user();
    const tag = (await platform(owner.id)).tag;
    const adminOwned = await link(admin.id, [tag]);
    await db!
      .$executeRaw`INSERT INTO "CoproductionAgreement" (mode, product, "productId", version, participants, "actorId") VALUES ('OWN', 'links-pagamento', ${adminOwned.id}, 1, ${JSON.stringify([{ userId: admin.id, percentageBps: 1000 }])}::jsonb, ${admin.id})`;
    const flagged = await find(adminOwned.id);
    expect(flagged.warnings).toContain('COPRODUCTION_ADMIN_PARTICIPANT');
    expect(flagged.classification).toMatchObject({
      status: 'NEEDS_DECISION',
      reasons: expect.arrayContaining(['COPRODUCTION_ADMIN_PARTICIPANT']),
    });
    const before = await db!.paymentLink.count();
    await audit();
    expect(await db!.paymentLink.count()).toBe(before);
    expect(await ownerOf(adminOwned.id)).toBe(admin.id);
  },
);

async function history(productId: string, userIds: string[]) {
  const tx = await db!.transaction.findMany({
    where: { paymentLinkId: productId },
  });
  const allocations = await db!.coproductionAllocation.findMany({
    where: { transactionId: { in: tx.map((t) => t.id) } },
  });
  const logs = await db!.balanceLog.findMany({
    where: { userId: { in: userIds } },
    orderBy: { id: 'asc' },
  });
  const wallets = await db!.wallet.findMany({
    where: { userId: { in: userIds } },
    orderBy: { id: 'asc' },
  });
  return JSON.stringify({ tx, allocations, logs, wallets });
}

run(
  'reassigns with dry-run, audit row, untouched history and idempotency',
  async () => {
    const admin = await user('ADMIN'),
      owner = await user();
    const tag = (await platform(owner.id)).tag;
    const product = await link(admin.id, [tag]);
    const transaction = await db!.transaction.create({
      data: {
        userId: admin.id,
        amount: 10,
        paymentLinkId: product.id,
        status: 'COMPLETED',
      },
    });
    await db!.coproductionAllocation.create({
      data: {
        transactionId: transaction.id,
        userId: admin.id,
        amount: 10,
        state: 'AVAILABLE',
      },
    });
    await db!.wallet.create({ data: { userId: admin.id, balance: 10 } });
    await db!.balanceLog.create({
      data: {
        userId: admin.id,
        action: 'CREDIT',
        transactionId: transaction.id,
        balanceDelta: 10,
        lockedDelta: 0,
        source: 'TEST',
      },
    });
    const ids = [admin.id, owner.id];
    const before = await history(product.id, ids);
    const mapping = [
      entry(product.id, owner.id, { expectedFromUserId: admin.id }),
    ];

    const dry = await reassignProducts(db!, mapping, { apply: false });
    expect(dry[0].outcome).toBe('WOULD_CHANGE');
    expect(await ownerOf(product.id)).toBe(admin.id);
    expect(
      await db!.productOwnershipChange.count({
        where: { productId: product.id },
      }),
    ).toBe(0);

    const applied = await reassignProducts(db!, mapping, { apply: true });
    expect(applied[0].outcome).toBe('CHANGED');
    expect(await ownerOf(product.id)).toBe(owner.id);
    expect(await history(product.id, ids)).toBe(before);
    const changes = await db!.productOwnershipChange.findMany({
      where: { productId: product.id },
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      fromUserId: admin.id,
      toUserId: owner.id,
      actor: 'SCRIPT',
      mappingHash: mappingHash(mapping),
    });

    const again = await reassignProducts(db!, mapping, { apply: true });
    expect(again[0]).toMatchObject({ outcome: 'SKIPPED' });
    expect(
      await db!.productOwnershipChange.count({
        where: { productId: product.id },
      }),
    ).toBe(1);
    expect((await find(product.id)).classification.status).toBe('OK');
  },
);

run(
  'rejects ineligible targets, platform mismatch, coproduction conflicts and rolls everything back',
  async () => {
    const admin = await user('ADMIN'),
      owner = await user(),
      stranger = await user(),
      inactive = await user('USER', { isActive: false }),
      purged = await user('USER', { isPurged: true });
    const tag = (await platform(owner.id)).tag;
    const good = await link(admin.id, [tag]);
    const holder = await user();
    const toAdmin = await link(holder.id);
    const mismatch = await link(admin.id, [tag]);
    const unregistered = await link(admin.id, ['UNREGISTERED-X']);
    const withAdminParticipant = await link(admin.id);
    await db!
      .$executeRaw`INSERT INTO "CoproductionAgreement" (mode, product, "productId", version, participants, "actorId") VALUES ('OWN', 'links-pagamento', ${withAdminParticipant.id}, 1, ${JSON.stringify([{ userId: admin.id, percentageBps: 500 }])}::jsonb, ${admin.id})`;
    const run1 = (entries: MappingEntry[]) =>
      reassignProducts(db!, entries, { apply: true }).then(
        () => null,
        (e) => e,
      );

    for (const [product, target, expected] of [
      [toAdmin.id, admin.id, 'TARGET_NOT_ELIGIBLE'],
      [toAdmin.id, inactive.id, 'TARGET_NOT_ELIGIBLE'],
      [toAdmin.id, purged.id, 'TARGET_NOT_ELIGIBLE'],
      [mismatch.id, stranger.id, 'PLATFORM_OWNER_MISMATCH'],
      [unregistered.id, owner.id, 'PLATFORM_NOT_REGISTERED_OR_INACTIVE'],
      [withAdminParticipant.id, owner.id, 'COPRODUCTION_ADMIN_PARTICIPANT'],
      [good.id, owner.id, 'OWNER_CHANGED_SINCE_APPROVAL'],
    ] as const) {
      const error = await run1([
        entry(
          product,
          target,
          expected === 'OWNER_CHANGED_SINCE_APPROVAL'
            ? { expectedFromUserId: stranger.id }
            : {},
        ),
      ]);
      expect(error).toBeInstanceOf(ReassignmentRejected);
      expect(JSON.stringify((error as ReassignmentRejected).results)).toContain(
        expected,
      );
    }
    // A valid entry next to an invalid one must not be applied (all-or-nothing).
    const error = await run1([
      entry(good.id, owner.id),
      entry(toAdmin.id, admin.id),
    ]);
    expect(error).toBeInstanceOf(ReassignmentRejected);
    expect(await ownerOf(good.id)).toBe(admin.id);
    // A failure while writing (audit insert) rolls back the product update too.
    const failing = entry(good.id, owner.id, { reason: 'ok' });
    await db!
      .$executeRaw`ALTER TABLE "ProductOwnershipChange" ADD CONSTRAINT "tmp_fail" CHECK ("reason" <> 'force-failure') NOT VALID`;
    try {
      const boom = await run1([{ ...failing, reason: 'force-failure' }]);
      expect(boom).toBeTruthy();
      expect(await ownerOf(good.id)).toBe(admin.id);
    } finally {
      await db!
        .$executeRaw`ALTER TABLE "ProductOwnershipChange" DROP CONSTRAINT "tmp_fail"`;
    }
    expect(
      await db!.productOwnershipChange.count({
        where: { productId: { in: [good.id, toAdmin.id, mismatch.id] } },
      }),
    ).toBe(0);
    expect(await run1([failing])).toBeNull();
    expect(await ownerOf(good.id)).toBe(owner.id);
  },
);

run('detects a concurrent owner change before writing', async () => {
  const admin = await user('ADMIN'),
    owner = await user(),
    racer = await user();
  const product = await link(admin.id);
  await db!.paymentLink.update({
    where: { id: product.id },
    data: { userId: racer.id },
  });
  const error = await reassignProducts(
    db!,
    [entry(product.id, owner.id, { expectedFromUserId: admin.id })],
    { apply: true },
  ).catch((e) => e);
  expect(error).toBeInstanceOf(ReassignmentRejected);
  expect(await ownerOf(product.id)).toBe(racer.id);
});

run(
  'delegated members that created a product can neither read nor edit it afterwards',
  async () => {
    const owner = await user(),
      member = await user();
    const product = await db!.paymentLink.create({
      data: {
        userId: owner.id,
        createdByUserId: member.id,
        title: 'Delegated',
        amount: 10,
      },
    });
    const repo = new PrismaPaymentLinkRepository(db as never);
    expect(
      await repo.findByIdForUser({ id: product.id, userId: member.id }),
    ).toBeNull();
    expect(
      await repo.findByIdForUser({ id: product.id, userId: owner.id }),
    ).not.toBeNull();
  },
);
