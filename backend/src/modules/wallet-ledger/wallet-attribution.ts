import { Prisma } from '@prisma/client';

type AttributionClient = Pick<Prisma.TransactionClient, '$queryRaw'>;
type BucketRow = {
  platformTag: string | null;
  nature: string | null;
  balance: Prisma.Decimal;
  locked: Prisma.Decimal;
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
        SUM("lockedDelta") AS locked
      FROM "BalanceLog" WHERE "userId" = ${userId}
      GROUP BY "platformTag", "nature"
      UNION ALL
      SELECT NULL::text, NULL::text, 0::numeric, 0::numeric
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
  return {
    userId,
    buckets: rows.map(({ platformTag, nature, balance, locked }) => ({
      platformTag,
      nature,
      balance,
      locked,
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
    consistent:
      walletBalance !== null &&
      walletLocked !== null &&
      balance.eq(walletBalance) &&
      locked.eq(walletLocked),
  };
}
