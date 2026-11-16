import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client } from 'pg';
import {
  assertReadOnlySql,
  connectReadOnly,
  runParity,
  type Db,
} from '../offer-parity-check';

// Guard tests need no database.
test('read-only guard accepts reads and refuses writes', () => {
  for (const ok of [
    'SELECT 1',
    'with a as (select 1) select * from a;',
    `SELECT 'update me' AS "deleteAt" FROM "Offer"`,
    'SHOW transaction_read_only',
  ])
    expect(() => assertReadOnlySql(ok)).not.toThrow();
  for (const bad of [
    'UPDATE "Offer" SET "isActive" = false',
    'DELETE FROM "Offer"',
    'INSERT INTO "Offer" DEFAULT VALUES',
    'SELECT 1; DROP TABLE "Offer"',
    'WITH d AS (DELETE FROM "Offer" RETURNING id) SELECT * FROM d',
    'SELECT * INTO copy FROM "Offer"',
    'SELECT * FROM "Offer" FOR UPDATE',
    'CREATE TEMP TABLE x (id int)',
    'SET ROLE postgres',
  ])
    expect(() => assertReadOnlySql(bad)).toThrow(/Refused/);
});

const url = process.env.OFFER_PARITY_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Tests require a local isolated database');
const pg = url ? new Client({ connectionString: url }) : null;
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!pg)(name, body, 60000);

const p = `par${crypto.randomUUID().slice(0, 8)}`;
const ids = {
  user: `${p}-user`,
  link: `${p}-link`,
  gone: `${p}-gone`,
  tx: `${p}-tx`,
};

beforeAll(async () => {
  if (!pg) return;
  await pg.connect();
  await pg.query(
    `INSERT INTO "AcquirerCatalogue" (code, name) VALUES ('DOM', 'DOM') ON CONFLICT DO NOTHING`,
  );
  await pg.query(
    `INSERT INTO "User" (id, name, email, password, "updatedAt") VALUES ($1, 'P', $2, 'x', now())`,
    [ids.user, `${ids.user}@local.test`],
  );
  await pg.query(
    `INSERT INTO "PaymentLink" (id, "userId", code, title, amount, "maxInstallments", "isActive",
       "domPaymentLinkId", "aceitaCartao", "aceitaPix", "aceitaDebito", "currentUses", "updatedAt")
     VALUES ($1, $2, $3, 'Link', 100.00, 3, false, $4, true, true, false, 2, now())`,
    [ids.link, ids.user, `${p}-code`, `${p}-dom`],
  );
  await pg.query(
    `INSERT INTO "Offer" (id, "ownerUserId", "createdByUserId", code, name, "amountCents", "isActive",
       "acceptedMethods", "maxInstallments", "usedCount", "renewalMode", "updatedAt")
     VALUES ($1, $2, $2, $3, 'Link', 10000, false, '{CREDIT_CARD,PIX}', 3, 2, 'NONE', now())`,
    [ids.link, ids.user, `${p}-code`],
  );
  await pg.query(
    `INSERT INTO "ExternalRef" (id, "acquirerCode", kind, "externalId", "entityType", "entityId")
     VALUES ($1, 'DOM', 'PAYMENT_LINK', $2, 'Offer', $3)`,
    [`${p}-ref`, `${p}-dom`, ids.link],
  );
  await pg.query(
    `INSERT INTO "Transaction" (id, "userId", amount, "netAmount", status, "paymentMethod",
       "paymentLinkId", "offerId", "updatedAt")
     VALUES ($1, $2, 100, 91, 'PENDING', 'PIX', $3, $3, now())`,
    [ids.tx, ids.user, ids.link],
  );
});

afterAll(async () => {
  if (!pg) return;
  await pg.query('DELETE FROM "Transaction" WHERE id = $1', [ids.tx]);
  await pg.query('DELETE FROM "ExternalRef" WHERE id = $1', [`${p}-ref`]);
  await pg.query(
    'DELETE FROM "CoproductionAgreement" WHERE "productId" = ANY($1)',
    [[ids.link, ids.gone]],
  );
  await pg.query('DELETE FROM "Offer" WHERE id = $1', [ids.link]);
  await pg.query('DELETE FROM "PaymentLink" WHERE id = $1', [ids.link]);
  await pg.query('DELETE FROM "User" WHERE id = $1', [ids.user]);
  await pg.end();
});

const mine = async (db: Db) =>
  (await runParity(db)).findings.filter(
    (f) =>
      f.severity === 'ERROR' && (f.ref?.startsWith(p) || f.message.includes(p)),
  );

run('a consistent product has no divergence', async () => {
  const { db, close } = await connectReadOnly(url!);
  try {
    expect(await mine(db)).toEqual([]);
  } finally {
    await close();
  }
});

run('divergences are reported per check', async () => {
  await pg!.query(
    `UPDATE "Offer" SET "amountCents" = 9999, "usedCount" = 7 WHERE id = $1`,
    [ids.link],
  );
  await pg!.query(`DELETE FROM "ExternalRef" WHERE id = $1`, [`${p}-ref`]);
  await pg!.query(
    `INSERT INTO "CoproductionAgreement" (product, "productId", version, participants, "actorId", mode)
     VALUES ('ofertas', $1, 1, '[]', $2, 'OWN')`,
    [ids.gone, ids.user],
  );
  const { db, close } = await connectReadOnly(url!);
  try {
    const checks = new Set((await mine(db)).map((f) => f.check));
    expect(checks).toEqual(
      new Set(['FIELDS', 'USED_COUNT', 'EXTERNAL_REF', 'COPRODUCTION']),
    );
  } finally {
    await close();
  }
});

run(
  'the connection is READ ONLY and a write fails even bypassing the guard',
  async () => {
    const raw = new Client({
      connectionString: url!,
      options: '-c default_transaction_read_only=on',
    });
    await raw.connect();
    try {
      await raw.query('BEGIN READ ONLY');
      await expect(
        raw.query(`UPDATE "Offer" SET "isActive" = true WHERE id = $1`, [
          ids.link,
        ]),
      ).rejects.toThrow(/read-only transaction/);
    } finally {
      await raw.query('ROLLBACK').catch(() => undefined);
      await raw.end();
    }
    const { db, close } = await connectReadOnly(url!);
    try {
      await expect(
        db.query(`UPDATE "Offer" SET "isActive" = true WHERE id = $1`, [
          ids.link,
        ]),
      ).rejects.toThrow(/Refused/);
      const [row] = await db.query<{ transaction_read_only: string }>(
        'SHOW transaction_read_only',
      );
      expect(row.transaction_read_only).toBe('on');
    } finally {
      await close();
    }
  },
);
