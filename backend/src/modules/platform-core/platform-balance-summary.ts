import { Prisma } from '@prisma/client';

type SummaryRow = {
  platform: string;
  ownerUserId: string;
  balance: Prisma.Decimal;
  locked: Prisma.Decimal;
  contas: bigint;
  complete: boolean;
};

/** Attribution only, never an independently spendable platform wallet.
 * Identity, ledger buckets and reconciliation are read in one MVCC snapshot.
 */
export async function readPlatformBalanceSummary(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
) {
  const rows = await client.$queryRaw<SummaryRow[]>`
    WITH platforms AS (
      SELECT DISTINCT transaction_canonical_platform_tag(tag) AS tag,
        "ownerUserId" FROM "Platform"
    ), external AS (
      SELECT transaction_canonical_platform_tag(platform) AS tag, "userId"
      FROM "ExternalPlatformUser" WHERE NOT "isDeleted"
    ), members AS (
      SELECT tag, "userId" FROM external WHERE "userId" IS NOT NULL
      UNION
      SELECT transaction_canonical_platform_tag("platformTag"), "userId"
      FROM "BalanceLog" WHERE "platformTag" IS NOT NULL
    ), ledger AS (
      SELECT "userId", SUM("balanceDelta") AS balance,
        SUM("lockedDelta") AS locked,
        BOOL_AND(transaction_canonical_platform_tag("platformTag") IS NOT NULL
          AND nature IS NOT NULL) AS known
      FROM "BalanceLog" GROUP BY "userId"
    ), buckets AS (
      SELECT "userId", transaction_canonical_platform_tag("platformTag") AS tag,
        SUM("balanceDelta") AS balance, SUM("lockedDelta") AS locked
      FROM "BalanceLog" GROUP BY "userId", transaction_canonical_platform_tag("platformTag")
    )
    SELECT LOWER(p.tag) AS platform, p."ownerUserId",
      COALESCE(SUM(b.balance), 0) AS balance,
      COALESCE(SUM(b.locked), 0) AS locked,
      COUNT(DISTINCT m."userId") AS contas,
      (NOT EXISTS (SELECT 1 FROM platforms other
          WHERE other.tag = p.tag AND other."ownerUserId" <> p."ownerUserId")
        AND BOOL_AND(COALESCE(l.known, FALSE)
        AND w."userId" IS NOT NULL
        AND l.balance = w.balance AND l.locked = w."lockedBalance")
        AND NOT EXISTS (SELECT 1 FROM external e
          WHERE e.tag = p.tag AND e."userId" IS NULL)) AS complete
    FROM platforms p
    LEFT JOIN members m ON m.tag = p.tag
    LEFT JOIN buckets b ON b."userId" = m."userId" AND b.tag = p.tag
    LEFT JOIN ledger l ON l."userId" = m."userId"
    LEFT JOIN "Wallet" w ON w."userId" = m."userId"
    GROUP BY p.tag, p."ownerUserId"
    ORDER BY LOWER(p.tag)
  `;
  return rows.map((row) => ({
    platform: row.platform,
    ownerUserId: row.ownerUserId,
    walletScope: 'beneficiary-platform-attribution' as const,
    attributionStatus: row.complete
      ? ('complete' as const)
      : ('unknown' as const),
    availabilityStatus: 'not-independent' as const,
    totalDisponivel: null,
    totalSaldoAtribuido: row.complete ? Number(row.balance) : null,
    totalBloqueado: row.complete ? Number(row.locked) : null,
    contas: Number(row.contas),
  }));
}
