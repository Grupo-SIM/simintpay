import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client } from 'pg';
import {
  assertLocalClassifierUrl,
  classifyExternalWallets,
} from '../scripts/classify-external-wallets';

// Supply a newly created disposable database. Never use application DATABASE_URL.
const url = process.env.EXTERNAL_CLASSIFIER_TEST_DATABASE_URL;
if (url) assertLocalClassifierUrl(url);
const db = url ? new Client({ connectionString: url }) : null;
beforeAll(async () => {
  await db?.connect();
});
afterAll(async () => {
  await db?.end();
});

test('rejects remote connections and libpq overrides without connecting', () => {
  for (const value of [
    'postgres://u@production/db',
    'postgres://u@localhost/db?host=production',
    'postgres://u@localhost/db?options=-csearch_path%3Devil',
  ]) {
    expect(() => assertLocalClassifierUrl(value)).toThrow();
  }
});

(url ? test : test.skip)(
  'PostgreSQL snapshot is stable, signed, conservative and read-only',
  async () => {
    // This test owns its database; refusing pre-existing tables prevents accidental reuse.
    await db!.query(`
    CREATE TABLE "User" (id text PRIMARY KEY, cpf text, cnpj text, "isPurged" boolean, "isActive" boolean);
    CREATE TABLE "Wallet" ("userId" text, balance numeric(12,2), "lockedBalance" numeric(12,2));
    CREATE TABLE "Platform" (id text, tag text, "ownerUserId" text);
    CREATE TABLE "ExternalPlatformUser" (id text PRIMARY KEY, platform text, "userId" text, cpf text, cnpj text, "isDeleted" boolean, "deletedAt" timestamp(3), "isPurged" boolean, "purgedAt" timestamp(3), "purgedAmount" numeric(12,2), "updatedAt" timestamp(3));
    CREATE TABLE "ExternalPlatformWallet" (id text, "externalUserId" text, balance numeric(12,2), "lockedBalance" numeric(12,2), "updatedAt" timestamp(3));
    CREATE TABLE "Transaction" (id text PRIMARY KEY, "platformTag" text, "userId" text);
    CREATE TABLE "BalanceLog" (id text PRIMARY KEY, "userId" text, "balanceDelta" numeric(12,2), "lockedDelta" numeric(12,2), "platformTag" text, nature text, source text, "transactionId" text, "createdAt" timestamp(3));
    INSERT INTO "User" VALUES ('beneficiary','123',NULL,false,true), ('ambiguous','123',NULL,false,true);
    INSERT INTO "Platform" VALUES ('p','alpha','beneficiary');
    INSERT INTO "Wallet" VALUES ('beneficiary',10,2);
    INSERT INTO "ExternalPlatformUser" VALUES ('a','alpha','beneficiary','123',NULL,false,NULL,false,NULL,NULL,now()), ('b','beta','beneficiary','123',NULL,true,now(),true,now(),10,now());
    INSERT INTO "ExternalPlatformWallet" VALUES ('wa','a',10,2,now()), ('wb','b',-5,0,now());
    INSERT INTO "Transaction" VALUES ('sale','beta','beneficiary');
    INSERT INTO "BalanceLog" VALUES ('log','beneficiary',10,2,'alpha','SALE','TEST','sale',now());
  `);
    const before = await db!.query(
      `SELECT md5(string_agg(row_to_json(t)::text, '' ORDER BY id)) AS digest FROM "ExternalPlatformUser" t`,
    );
    const first = await classifyExternalWallets(url!);
    expect(await classifyExternalWallets(url!)).toEqual(first);
    // PostgreSQL timestamp-without-time-zone must not be interpreted in the CLI's local TZ.
    for (const timezone of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo']) {
      const child = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          `${import.meta.dir}/../scripts/classify-external-wallets.ts`,
          '--local-database-url',
          url!,
        ],
        {
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: timezone },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const manifest = JSON.parse(await new Response(child.stdout).text());
      expect(await child.exited).toBe(0);
      expect(manifest).toEqual(first);
    }
    expect(
      first.entries.every(
        (entry) =>
          entry.classification === 'QUARANTINE' &&
          entry.proposedCredit === null &&
          entry.authorizedCredit === '0.00',
      ),
    ).toBe(true);
    expect(first.entries[0].reasons).toContain(
      'OWNER_MIRROR_CANDIDATE_NOT_PROOF',
    );
    expect(first.entries[0].reasons).toContain(
      'LEDGER_EXISTS_BUT_REPRESENTATION_UNPROVEN',
    );
    expect(first.entries[0].reasons).toContain('DOCUMENT_IDENTITY_NOT_UNIQUE');
    expect(first.entries[0].reasons).toContain(
      'MULTI_PLATFORM_IDENTITY_REQUIRES_REVIEW',
    );
    expect(first.entries[0].reasons).toContain('NONZERO_EXTERNAL_LOCKS');
    expect(first.entries[1].reasons).toContain('NEGATIVE_EXTERNAL_BALANCE');
    expect(first.entries[1].reasons).toContain('PRESERVE_EXTERNAL_TOMBSTONE');
    expect(first.entries[1].evidence.balance).toBe('-5.00');
    expect(first.entries[0].evidence.ledger[0].transactionPlatform).toBe(
      'beta',
    );
    expect(
      (
        await db!.query(
          `SELECT md5(string_agg(row_to_json(t)::text, '' ORDER BY id)) AS digest FROM "ExternalPlatformUser" t`,
        )
      ).rows,
    ).toEqual(before.rows);
    await db!.query(
      `UPDATE "BalanceLog" SET "balanceDelta" = -10 WHERE id = 'log'`,
    );
    expect((await classifyExternalWallets(url!)).fingerprint).not.toBe(
      first.fingerprint,
    );
  },
);
