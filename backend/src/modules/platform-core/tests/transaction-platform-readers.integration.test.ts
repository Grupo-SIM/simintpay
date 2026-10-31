import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { ownedReportSource } from '../../../application/services/owned-report-source';
import { PlatformAttributedBalance } from '../platform-attributed-balance';
import { PlatformFinanceService } from '../../unified-platform/finance/platform-finance.service';
import {
  sqlTransactionPlatform,
  transactionPlatformTag,
  whereTransactionPlatform,
} from '../transaction-platform';

/**
 * Platform readers must follow Transaction.platformTag only. Runs the real readers against a local
 * disposable Postgres where the real migration SQL (column + trigger) is applied.
 */
const url = process.env.COPRODUCTION_TEST_DATABASE_URL;
if (
  url &&
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)
) {
  throw new Error('Tests require a local isolated database');
}
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const migration = resolve(
  import.meta.dir,
  '../../../../prisma/migrations/20261029120000_transaction_platform_tag/migration.sql',
);
beforeAll(async () => {
  if (!url) return;
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(readFileSync(migration, 'utf8'));
  await client.end();
});
afterAll(async () => {
  await db?.$disconnect();
});
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 30000);

const suffix = () => crypto.randomUUID().slice(0, 8).toUpperCase();
async function fixture() {
  const s = suffix();
  const owner = await db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Owner',
      password: 'x',
      role: 'USER',
    },
  });
  const [first, second] = await Promise.all(
    [`ALPHA-${s}`, `BETA-${s}`].map((tag) =>
      db!.platform.create({
        data: { tag, name: tag, ownerUserId: owner.id },
      }),
    ),
  );
  const sale = (
    description: string | null,
    extra: Record<string, unknown> = {},
    netAmount = 10,
  ) =>
    db!.transaction.create({
      data: {
        userId: owner.id,
        amount: netAmount,
        netAmount,
        status: 'COMPLETED',
        description,
        ...extra,
      },
    });
  const scope = [first, second].map(({ id, tag, ownerUserId }) => ({
    id,
    tag,
    ownerUserId,
  }));
  const report = async (platform: {
    id: string;
    tag: string;
    ownerUserId: string;
  }) =>
    (
      await db!.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM (${ownedReportSource([platform], {})}) r`,
      )
    ).map((row) => row.id);
  return { s, owner, first, second, sale, scope, report };
}
const ids = async (where: Prisma.TransactionWhereInput) =>
  (await db!.transaction.findMany({ where, select: { id: true } })).map(
    (row) => row.id,
  );

run(
  'editing platformTag moves a transaction between platform reports while the description stays',
  async () => {
    const f = await fixture();
    const row = await f.sale(`Pedido [TENANT:${f.first.tag}]`);
    expect(await f.report(f.first)).toContain(row.id);
    expect(await f.report(f.second)).not.toContain(row.id);
    expect(await ids(whereTransactionPlatform(f.first.tag))).toContain(row.id);

    await db!.transaction.update({
      where: { id: row.id },
      data: { platformTag: f.second.tag.toLowerCase().replaceAll('-', '_') },
    });
    const moved = await db!.transaction.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(moved.description).toBe(`Pedido [TENANT:${f.first.tag}]`);
    expect(transactionPlatformTag(moved)).toBe(f.second.tag);
    expect(await f.report(f.second)).toContain(row.id);
    expect(await f.report(f.first)).not.toContain(row.id);
    expect(await ids(whereTransactionPlatform(f.first.tag))).not.toContain(
      row.id,
    );
    expect(await ids(whereTransactionPlatform(f.second.tag))).toContain(row.id);
    expect(
      await db!.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT t.id FROM "Transaction" t WHERE t.id = ${row.id} AND ${sqlTransactionPlatform('t', f.second.tag)}`,
      ),
    ).toHaveLength(1);
  },
);

run(
  'description edits never move a transaction between platform reports',
  async () => {
    const f = await fixture();
    const row = await f.sale(`Pedido [TENANT:${f.first.tag}]`);
    await db!.transaction.update({
      where: { id: row.id },
      data: { description: `Outro [TENANT:${f.second.tag}] ${f.second.tag}` },
    });
    expect(await f.report(f.first)).toContain(row.id);
    expect(await f.report(f.second)).not.toContain(row.id);
    expect(await ids(whereTransactionPlatform(f.second.tag))).not.toContain(
      row.id,
    );
  },
);

run(
  'null-tag rows are excluded from platform reports and counted as unidentified',
  async () => {
    const f = await fixture();
    const untagged = await f.sale('Pedido sem marca');
    const cleared = await f.sale(`Pedido [TENANT:${f.first.tag}]`);
    await db!.transaction.update({
      where: { id: cleared.id },
      data: { platformTag: null },
    });
    for (const platform of [f.first, f.second]) {
      const reported = await f.report(platform);
      expect(reported).not.toContain(untagged.id);
      expect(reported).not.toContain(cleared.id);
      expect(await ids(whereTransactionPlatform(platform.tag))).not.toContain(
        cleared.id,
      );
    }
    const balance = await db!.$transaction((p) =>
      new PlatformAttributedBalance(db! as never).readSnapshot(p, {
        id: f.first.id,
        tag: f.first.tag,
        ownerUserId: f.owner.id,
        acquirer: 'DOM',
      } as never),
    );
    expect(balance).toMatchObject({
      identifiedTransactions: 0,
      unidentifiedOwnerTransactions: 2,
      historicalAttributionComplete: false,
    });
  },
);

run(
  'alias tags normalize in the stored column and in every query builder',
  async () => {
    const f = await fixture();
    const zero = await f.sale('Zero [TENANT:ZERO_GRAU]');
    const hyphenated = await f.sale(null, { platformTag: 'zero-grau' });
    const ebook = await f.sale('Ebook [TENANT:EBOOKSIM]');
    expect(
      transactionPlatformTag(
        await db!.transaction.findUniqueOrThrow({ where: { id: zero.id } }),
      ),
    ).toBe('ZERO-GRAU');
    const both = await ids({
      userId: f.owner.id,
      ...whereTransactionPlatform('ZERO_GRAU'),
    });
    expect(both.sort()).toEqual([zero.id, hyphenated.id].sort());
    expect(
      await ids({
        userId: f.owner.id,
        ...whereTransactionPlatform(['EBOOKSIM']),
      }),
    ).toEqual([ebook.id]);
    expect(
      await ids({
        userId: f.owner.id,
        ...whereTransactionPlatform(['EBOOK', 'ebooksim']),
      }),
    ).toEqual([ebook.id]);
  },
);

run(
  'explicit null stays untagged for a sole owner with a platform-bound payment link',
  async () => {
    const f = await fixture();
    await db!.platform.delete({ where: { id: f.second.id } });
    const link = await db!.paymentLink.create({
      data: {
        userId: f.owner.id,
        title: 'Bound link',
        amount: 10,
        plataformas: [f.first.tag],
      },
    });
    const row = await f.sale(`Pedido [TENANT:${f.first.tag}]`, {
      paymentLinkId: link.id,
    });
    expect(await f.report(f.first)).toContain(row.id);
    await db!.transaction.update({
      where: { id: row.id },
      data: { platformTag: null },
    });
    expect(await f.report(f.first)).not.toContain(row.id);
    expect(
      await ids({
        userId: f.owner.id,
        ...whereTransactionPlatform(f.first.tag),
      }),
    ).toEqual([]);
  },
);

run('POS terminal names never become the transaction platform', async () => {
  const f = await fixture();
  const renamed = await db!.platform.findMany({
    where: { tag: { in: ['RENOVADA', 'POS'] } },
    select: { id: true, tag: true },
  });
  // This file owns its disposable database; release fixed regression tags between repeated runs.
  for (const platform of renamed) {
    await db!.platform.update({
      where: { id: platform.id },
      data: { tag: `${platform.tag}-${suffix()}` },
    });
  }
  await db!.platform.update({
    where: { id: f.first.id },
    data: { tag: 'RENOVADA' },
  });
  const row = await f.sale(
    'Maquineta - Terminal: POS-RENOVADA [ORIGEM:MAQUINETA]',
    { platformTag: 'RENOVADA' },
  );
  expect(transactionPlatformTag(row)).toBe('RENOVADA');
  expect(
    await ids({ userId: f.owner.id, ...whereTransactionPlatform('RENOVADA') }),
  ).toEqual([row.id]);
  expect(
    await ids({ userId: f.owner.id, ...whereTransactionPlatform('POS') }),
  ).toEqual([]);
  expect(await f.report({ ...f.first, tag: 'RENOVADA' })).toContain(row.id);
  await db!.platform.update({
    where: { id: f.second.id },
    data: { tag: 'POS' },
  });
  expect(await f.report({ ...f.second, tag: 'POS' })).not.toContain(row.id);
  await db!.transaction.update({
    where: { id: row.id },
    data: { platformTag: null },
  });
  expect(await f.report({ ...f.first, tag: 'RENOVADA' })).not.toContain(row.id);
});

run(
  'platform finance report totals follow the tag, not the description',
  async () => {
    const f = await fixture();
    const kept = await f.sale(`Venda [TENANT:${f.first.tag}]`, {}, 10);
    const moved = await f.sale(`Venda [TENANT:${f.first.tag}]`, {}, 20);
    await db!.transaction.update({
      where: { id: moved.id },
      data: { platformTag: f.second.tag },
    });
    await f
      .sale(`Venda [TENANT:${f.first.tag}]`, { platformTag: null }, 40)
      .then((row) =>
        db!.transaction.update({
          where: { id: row.id },
          data: { platformTag: null },
        }),
      );
    const service = new PlatformFinanceService(db! as never);
    const context = {
      id: f.first.id,
      tag: f.first.tag,
      ownerUserId: f.owner.id,
    } as never;
    const first = await service.report(context);
    const second = await service.report({
      ...(context as object),
      id: f.second.id,
      tag: f.second.tag,
    } as never);
    expect(first).toMatchObject({
      completedTransactions: 1,
      netAmountCents: 1000,
    });
    expect(second).toMatchObject({
      completedTransactions: 1,
      netAmountCents: 2000,
    });
    expect(kept.id).not.toBe(moved.id);
  },
);
