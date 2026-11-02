import { Prisma } from '@prisma/client';
import { canonicalTransactionPlatformTag } from './transaction-platform';

type Client = Pick<Prisma.TransactionClient, '$queryRaw'>;
type Row = {
  userId: string;
  platformTag: string | null;
  nature: string | null;
  balance: Prisma.Decimal;
  locked: Prisma.Decimal;
  rowCount: bigint;
  walletBalance: Prisma.Decimal | null;
  walletLocked: Prisma.Decimal | null;
};

/** One batched statement/snapshot; membership is identity, never a source of money. */
export async function readSellerWalletAttribution(
  client: Client,
  userIds: string[],
  tag: string,
) {
  const ids = [...new Set(userIds)];
  const result = new Map<string, ReturnType<typeof project>>();
  if (!ids.length) return result;
  const rows = await client.$queryRaw<Row[]>`
    SELECT u.id AS "userId", b."platformTag", b.nature,
      COALESCE(SUM(b."balanceDelta"), 0) AS balance,
      COALESCE(SUM(b."lockedDelta"), 0) AS locked, COUNT(b.id) AS "rowCount",
      w.balance AS "walletBalance", w."lockedBalance" AS "walletLocked"
    FROM "User" u LEFT JOIN "Wallet" w ON w."userId" = u.id
    LEFT JOIN "BalanceLog" b ON b."userId" = u.id
    WHERE u.id IN (${Prisma.join(ids)})
    GROUP BY u.id, b."platformTag", b.nature, w.balance, w."lockedBalance"
  `;
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const buckets = grouped.get(row.userId) ?? [];
    buckets.push(row);
    grouped.set(row.userId, buckets);
  }
  for (const [id, buckets] of grouped) result.set(id, project(buckets, tag));
  return result;
}

function project(rows: Row[], tag: string) {
  const sum = (field: 'balance' | 'locked', buckets = rows) =>
    buckets.reduce(
      (total, row) => total.add(row[field]),
      new Prisma.Decimal(0),
    );
  const count = rows.reduce((total, row) => total + Number(row.rowCount), 0);
  const historicalAttributionComplete =
    count > 0 &&
    rows.every(
      (row) =>
        !Number(row.rowCount) ||
        (row.platformTag !== null && row.nature !== null),
    );
  const first = rows[0];
  const walletStatus =
    first.walletBalance === null
      ? 'missing'
      : sum('balance').eq(first.walletBalance) &&
          sum('locked').eq(first.walletLocked ?? 0)
        ? 'consistent'
        : 'mismatch';
  const complete =
    historicalAttributionComplete && walletStatus === 'consistent';
  const selected = rows.filter(
    (row) =>
      row.platformTag !== null &&
      canonicalTransactionPlatformTag(row.platformTag) ===
        canonicalTransactionPlatformTag(tag),
  );
  return {
    walletScope: 'beneficiary-platform' as const,
    balance: complete ? sum('balance', selected).toNumber() : null,
    lockedBalance: complete ? sum('locked', selected).toNumber() : null,
    balanceStatus: complete ? ('complete' as const) : ('unavailable' as const),
    historicalAttributionComplete,
    walletStatus,
  };
}

export const unavailableSellerWallet = {
  walletScope: 'beneficiary-platform' as const,
  balance: null,
  lockedBalance: null,
  balanceStatus: 'unavailable' as const,
  historicalAttributionComplete: false,
  walletStatus: 'missing' as const,
};
