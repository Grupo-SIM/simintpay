import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';

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
  // The trigger lives only in the migration (db push does not create it): apply the real SQL file.
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

const owner = () =>
  db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Tag',
      password: 'x',
      role: 'USER',
    },
  });
const sale = (
  userId: string,
  description: string | null,
  extra: Record<string, unknown> = {},
) =>
  db!.transaction.create({
    data: {
      userId,
      amount: 1,
      netAmount: 1,
      status: 'COMPLETED',
      description,
      ...extra,
    },
  });
const tagOf = async (id: string) =>
  (await db!.transaction.findUniqueOrThrow({ where: { id } })).platformTag;

run(
  'derives the canonical tag from the TENANT marker, treating ZERO_GRAU and ZERO-GRAU alike',
  async () => {
    const u = await owner();
    const underscore = await sale(u.id, 'Pedido Zero Grau [TENANT:ZERO_GRAU]');
    const hyphen = await sale(u.id, 'Pedido [tenant:zero-grau] extra');
    const ebook = await sale(u.id, 'livro [TENANT:EBOOKSIM]');
    const none = await sale(u.id, 'Pedido Zero Grau sem marca');
    const empty = await sale(u.id, null);
    expect(await tagOf(underscore.id)).toBe('ZERO-GRAU');
    expect(await tagOf(hyphen.id)).toBe('ZERO-GRAU');
    expect(await tagOf(ebook.id)).toBe('EBOOK');
    expect(await tagOf(none.id)).toBeNull();
    expect(await tagOf(empty.id)).toBeNull();
  },
);

run(
  'is a plain editable field after insert: description edits never change it',
  async () => {
    const u = await owner();
    const row = await sale(u.id, 'Pedido [TENANT:RENOVADA]');
    await db!.transaction.update({
      where: { id: row.id },
      data: { description: 'Pedido [TENANT:BOSQUE]' },
    });
    expect(await tagOf(row.id)).toBe('RENOVADA');

    await db!.transaction.update({
      where: { id: row.id },
      data: { platformTag: 'zero_grau' },
    });
    expect(await tagOf(row.id)).toBe('ZERO-GRAU');
    await db!.transaction.update({
      where: { id: row.id },
      data: { description: 'Pedido [TENANT:ATLAS]' },
    });
    expect(await tagOf(row.id)).toBe('ZERO-GRAU');
  },
);

run(
  'a tag supplied on insert wins over the description, and null means no platform',
  async () => {
    const u = await owner();
    const row = await sale(u.id, 'Pedido [TENANT:RENOVADA]', {
      platformTag: 'Zero_Grau',
    });
    expect(await tagOf(row.id)).toBe('ZERO-GRAU');
    await db!.transaction.update({
      where: { id: row.id },
      data: { platformTag: null },
    });
    expect(await tagOf(row.id)).toBeNull();
  },
);

run('backfill fills existing rows that have no tag', async () => {
  const u = await owner();
  const row = await sale(u.id, 'Pedido [TENANT:ZERO_GRAU]');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(
    'UPDATE "Transaction" SET "platformTag" = NULL WHERE id = $1',
    [row.id],
  );
  expect(await tagOf(row.id)).toBeNull();
  await client.query(readFileSync(migration, 'utf8'));
  await client.end();
  expect(await tagOf(row.id)).toBe('ZERO-GRAU');
});
