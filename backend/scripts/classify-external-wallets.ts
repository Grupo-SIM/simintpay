import { createHash } from 'node:crypto';
import { Client } from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Explicit opt-in only: never reads DATABASE_URL or the application's .env. */
export function assertLocalClassifierUrl(value: string): void {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !LOCAL_HOSTS.has(url.hostname)
  ) {
    throw new Error('Classifier requires an explicit localhost PostgreSQL URL');
  }
  // libpq connection overrides could otherwise redirect a nominally local URL.
  if ([...url.searchParams.keys()].some((key) => !['sslmode'].includes(key))) {
    throw new Error('Connection override parameters are forbidden');
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** No evidence of original external credits exists in the legacy schema. Never infer funding. */
export async function classifyExternalWallets(connectionString: string) {
  assertLocalClassifierUrl(connectionString);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const { rows } = await client.query(`
      SELECT e.id, e.platform, e."userId", e."isDeleted",
        to_char(e."deletedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "deletedAt", e."isPurged",
        to_char(e."purgedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "purgedAt",
        e."purgedAmount"::text,
        to_char(e."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "identityUpdatedAt",
        x.id AS "externalWalletId", x.balance::text, x."lockedBalance"::text,
        to_char(x."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "walletUpdatedAt",
        u."isPurged" AS "beneficiaryPurged", u."isActive" AS "beneficiaryActive",
        w.balance::text AS "cacheBalance", w."lockedBalance"::text AS "cacheLocked",
        (SELECT COALESCE(sum(l."balanceDelta"), 0)::text FROM "BalanceLog" l WHERE l."userId" = e."userId") AS "ledgerBalance",
        (SELECT COALESCE(sum(l."lockedDelta"), 0)::text FROM "BalanceLog" l WHERE l."userId" = e."userId") AS "ledgerLocked",
        (SELECT count(*)::text FROM "User" candidate WHERE
          (e.cpf IS NOT NULL AND regexp_replace(candidate.cpf, '[^0-9]', '', 'g') = regexp_replace(e.cpf, '[^0-9]', '', 'g')) OR
          (e.cnpj IS NOT NULL AND regexp_replace(candidate.cnpj, '[^0-9]', '', 'g') = regexp_replace(e.cnpj, '[^0-9]', '', 'g'))) AS "documentMatches",
        (SELECT count(*)::text FROM "ExternalPlatformUser" sibling WHERE sibling."userId" = e."userId") AS "linkedExternalIdentities",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'tag', p.tag, 'ownerUserId', p."ownerUserId") ORDER BY p.id)
          FROM "Platform" p WHERE lower(p.tag) = lower(e.platform)), '[]'::jsonb) AS platforms,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', l.id, 'balanceDelta', l."balanceDelta"::text, 'lockedDelta', l."lockedDelta"::text,
          'platformTag', l."platformTag", 'nature', l.nature, 'source', l.source,
          'transactionId', l."transactionId", 'transactionPlatform', t."platformTag",
          'transactionBeneficiaryId', t."userId", 'createdAt', to_char(l."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY l.id)
          FROM "BalanceLog" l LEFT JOIN "Transaction" t ON t.id = l."transactionId"
          WHERE l."userId" = e."userId"), '[]'::jsonb) AS ledger
      FROM "ExternalPlatformUser" e
      LEFT JOIN "ExternalPlatformWallet" x ON x."externalUserId" = e.id
      LEFT JOIN "User" u ON u.id = e."userId"
      LEFT JOIN "Wallet" w ON w."userId" = u.id
      ORDER BY e.id
    `);
    const entries = rows.map((row) => {
      const reasons = [
        'EXTERNAL_FUNDING_HISTORY_UNAVAILABLE',
        'NO_DURABLE_EXTERNAL_TO_LEDGER_PROVENANCE',
      ];
      if (!row.userId) reasons.push('NO_EXPLICIT_BENEFICIARY_LINK');
      if (row.documentMatches !== '1')
        reasons.push('DOCUMENT_IDENTITY_NOT_UNIQUE');
      if (Number(row.linkedExternalIdentities) > 1)
        reasons.push('MULTI_PLATFORM_IDENTITY_REQUIRES_REVIEW');
      if (row.platforms.length !== 1)
        reasons.push('PLATFORM_NOT_UNIQUE_OR_UNKNOWN');
      if (
        row.platforms.some(
          (p: { ownerUserId: string }) => p.ownerUserId === row.userId,
        )
      )
        reasons.push('OWNER_MIRROR_CANDIDATE_NOT_PROOF');
      if (row.ledger.length)
        reasons.push('LEDGER_EXISTS_BUT_REPRESENTATION_UNPROVEN');
      if (row.isDeleted || row.isPurged)
        reasons.push('PRESERVE_EXTERNAL_TOMBSTONE');
      if (row.beneficiaryPurged || row.beneficiaryActive === false)
        reasons.push('BENEFICIARY_INACTIVE_OR_PURGED');
      if (!row.externalWalletId) reasons.push('EXTERNAL_WALLET_MISSING');
      if (row.lockedBalance && /[1-9]/.test(row.lockedBalance))
        reasons.push('NONZERO_EXTERNAL_LOCKS');
      if (row.balance?.startsWith('-') && /[1-9]/.test(row.balance))
        reasons.push('NEGATIVE_EXTERNAL_BALANCE');
      const sourceFingerprint = fingerprint({ version: 1, evidence: row });
      return {
        externalUserId: row.id,
        classification: 'QUARANTINE' as const,
        proposedCredit: null,
        proposedLockedCredit: null,
        authorizedCredit: '0.00',
        reasons,
        sourceFingerprint,
        idempotencyIdentifier: `external-wallet-review:v1:${row.id}:${sourceFingerprint}`,
        evidence: row,
      };
    });
    await client.query('ROLLBACK');
    return {
      version: 1,
      mode: 'READ_ONLY_REVIEW',
      financialWritesAllowed: false,
      entries,
      fingerprint: fingerprint(entries),
    };
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--local-database-url') {
    throw new Error(
      'Usage: classify-external-wallets.ts --local-database-url postgres://...@localhost/disposable_database',
    );
  }
  classifyExternalWallets(args[1])
    .then((manifest) => {
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
