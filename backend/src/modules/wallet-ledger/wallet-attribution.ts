import { Prisma } from '@prisma/client';
import { canonicalTransactionPlatformTag } from '../platform-core/transaction-platform';

type AttributionClient = Pick<Prisma.TransactionClient, '$queryRaw'>;
type BucketRow = {
  platformTag: string | null;
  nature: string | null;
  balance: Prisma.Decimal;
  locked: Prisma.Decimal;
  rowCount: bigint;
  walletBalance: Prisma.Decimal | null;
  walletLocked: Prisma.Decimal | null;
};

/**
 * One PostgreSQL statement = one MVCC snapshot, including the wallet cache.
 * Beneficiary is always BalanceLog.userId, never today's platform owner or membership.
 * Signed buckets are attribution, not independently spendable wallets. NULL dimensions
 * remain visible; no source/description/transaction inference or historical ownership join.
 */
export async function readWalletAttribution(
  client: AttributionClient,
  userId: string,
) {
  const rows = await client.$queryRaw<BucketRow[]>`
    WITH buckets AS (
      SELECT "platformTag", "nature", SUM("balanceDelta") AS balance,
        SUM("lockedDelta") AS locked, COUNT(*) AS "rowCount"
      FROM "BalanceLog" WHERE "userId" = ${userId}
      GROUP BY "platformTag", "nature"
      UNION ALL
      SELECT NULL::text, NULL::text, 0::numeric, 0::numeric, 0::bigint
      WHERE NOT EXISTS (
        SELECT 1 FROM "BalanceLog" WHERE "userId" = ${userId}
          AND "platformTag" IS NULL AND "nature" IS NULL
      )
    )
    SELECT b.*, w.balance AS "walletBalance", w."lockedBalance" AS "walletLocked"
    FROM buckets b LEFT JOIN "Wallet" w ON w."userId" = ${userId}
    ORDER BY b."platformTag" NULLS FIRST, b."nature" NULLS FIRST
  `;
  const balance = rows.reduce(
    (sum, row) => sum.add(row.balance),
    new Prisma.Decimal(0),
  );
  const locked = rows.reduce(
    (sum, row) => sum.add(row.locked),
    new Prisma.Decimal(0),
  );
  const walletBalance = rows[0]?.walletBalance ?? null;
  const walletLocked = rows[0]?.walletLocked ?? null;
  const rowCount = rows.reduce((sum, row) => sum + Number(row.rowCount), 0);
  const unknownPlatformHistory = rows.reduce(
    (sum, row) => sum + (row.platformTag === null ? Number(row.rowCount) : 0),
    0,
  );
  const unknownNatureHistory = rows.reduce(
    (sum, row) => sum + (row.nature === null ? Number(row.rowCount) : 0),
    0,
  );
  const walletPresent = walletBalance !== null && walletLocked !== null;
  const consistent =
    walletPresent && balance.eq(walletBalance) && locked.eq(walletLocked);
  return {
    userId,
    rowCount,
    unknownPlatformHistory,
    unknownNatureHistory,
    historicalAttributionComplete:
      unknownPlatformHistory === 0 && unknownNatureHistory === 0,
    ledgerStatus: rowCount === 0 ? ('missing' as const) : ('present' as const),
    walletStatus: !walletPresent
      ? ('missing' as const)
      : consistent
        ? ('consistent' as const)
        : ('mismatch' as const),
    buckets: rows.map(({ platformTag, nature, balance, locked, rowCount }) => ({
      platformTag,
      nature,
      balance,
      locked,
      rowCount: Number(rowCount),
    })),
    balance,
    locked,
    // Clamp once, globally. Summing independently clamped buckets invents availability.
    available: Prisma.Decimal.max(0, balance.sub(locked)),
    wallet:
      walletBalance === null || walletLocked === null
        ? null
        : {
            balance: walletBalance,
            locked: walletLocked,
          },
    consistent,
  };
}

/** Select attribution only: the wallet remains pooled, never a platform spending limit.
 * An unlinked adapter must not call this with an inferred owner or platform.
 */
export function selectWalletPlatformAttribution(
  snapshot: Awaited<ReturnType<typeof readWalletAttribution>>,
  platformTag: string,
) {
  const canonical = canonicalTransactionPlatformTag(platformTag);
  if (!canonical) throw new Error('A linked canonical platform is required');
  const buckets = snapshot.buckets.filter(
    (bucket) =>
      canonicalTransactionPlatformTag(bucket.platformTag) === canonical,
  );
  return {
    platformTag: canonical,
    balance: buckets.reduce(
      (sum, bucket) => sum.add(bucket.balance),
      new Prisma.Decimal(0),
    ),
    locked: buckets.reduce(
      (sum, bucket) => sum.add(bucket.locked),
      new Prisma.Decimal(0),
    ),
    rowCount: buckets.reduce((sum, bucket) => sum + bucket.rowCount, 0),
    pooledWallet: snapshot.wallet,
    walletStatus: snapshot.walletStatus,
    ledgerStatus: snapshot.ledgerStatus,
    unknownPlatformHistory: snapshot.unknownPlatformHistory,
    unknownNatureHistory: snapshot.unknownNatureHistory,
    historicalAttributionComplete: snapshot.historicalAttributionComplete,
  };
}
