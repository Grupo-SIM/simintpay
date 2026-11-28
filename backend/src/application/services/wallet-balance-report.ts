import { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

export type WalletBucketKind = 'platform' | 'simintpay' | 'unidentified';
export type WalletBucket = {
  key: string;
  kind: WalletBucketKind;
  tag: string | null;
  name: string;
  isActive: boolean | null;
  balanceCents: number;
  lockedCents: number;
  availableCents: number;
  periodReceivedCents: number;
  periodWithdrawnCents: number;
  /** Requested and not yet decided, any platform acquirer. */
  pendingWithdrawalsCents: number;
};
export type WalletPerson = {
  id: string;
  name: string;
  email: string;
  balanceCents: number;
  lockedCents: number;
  availableCents: number;
  /** Withdrawn in the period (approved/completed), at person level: never part of a platform bucket. */
  periodWithdrawnCents: number;
  /** All-time figures, never filtered by period. */
  totals: {
    availableCents: number;
    receivedCents: number;
    withdrawnCents: number;
    pendingWithdrawalsCents: number;
  };
  platforms: WalletBucket[];
};

const SIMINTPAY = 'SIMINTPAY';
const NONE = '__NONE__';

/**
 * SQL key of a ledger/withdrawal tag. The reserved policy contexts (GLOBAL, SIMINTPAY,
 * CLIENT:/USER:) are the SimIntPay pseudo-platform; an empty tag stays unattributed (NULL).
 */
const keySql = (tag: Prisma.Sql) => Prisma.sql`(CASE
  WHEN nullif(btrim(${tag}), '') IS NULL THEN NULL
  WHEN upper(btrim(${tag})) IN ('SIMINTPAY', 'GLOBAL') OR upper(btrim(${tag})) ~ '^(USER|CLIENT):' THEN ${SIMINTPAY}
  WHEN upper(btrim(${tag})) = 'EBOOKSIM' THEN 'EBOOK'
  ELSE replace(upper(btrim(${tag})), '_', '-') END)`;

/**
 * Ledger movements that are not product credits: withdrawal reservations/debits, withdrawal fees, adjustments,
 * reconciliations and manual/administrative entries. They never enter a bucket through the ledger, whatever tag or
 * transaction they carry. Withdrawals reach the buckets through `WithdrawRequest.platform` instead.
 */
const ownMovementSql = Prisma.sql`(bl.action LIKE 'WITHDRAW\\_%' OR bl.action LIKE 'ADMIN\\_%'
  OR bl.action IN ('ADJUSTMENT', 'WALLET_RECALCULATE', 'ATLAS_WALLET_ZERO', 'MAQUINETA_CORRECTION')
  OR coalesce(bl.nature, '') IN ('WITHDRAWAL', 'ADJUSTMENT')
  OR bl.source IN ('RECONCILIATION', 'MASTER_ADMIN_CONTROL', 'ADMIN_SYNC'))`;

const ledgerKeyOf = () => Prisma.sql`(CASE WHEN ${ownMovementSql} THEN NULL
  ELSE ${keySql(Prisma.sql`coalesce(nullif(btrim(bl."platformTag"), ''), tx."platformTag")`)} END)`;

const cents = (value: Prisma.Decimal | number | null | undefined) => {
  const result = new Prisma.Decimal(value ?? 0)
    .mul(100)
    .toDecimalPlaces(0)
    .toNumber();
  if (!Number.isSafeInteger(result)) throw new Error('Saldo fora do limite');
  return result;
};

type Page = { page: number; pageSize: number; skip: number };
type Range = { start?: Date; end?: Date };

/**
 * Wallet-first balances. A person's product credits (sales, commission, coproduction, affiliate) are split by the
 * platform that originated them (margin affiliate/coproduction included) and credits without
 * attribution stay in "unidentified". Each withdrawal is deducted from the platform it was requested on, so a
 * bucket is that platform's share of the wallet. Adjustments, fees and manual entries only change the person's
 * wallet, so the buckets may still differ from it by those (the wallet is the person's `availableCents`).
 */
export async function walletBalanceReport(
  db: Db,
  input: {
    /** Restrict to one person (client view); omitted lists everybody with balance except administrators. */
    onlyUserId?: string;
    search?: string;
    alphabetic: (value: Prisma.Sql) => Prisma.Sql;
    pagination: Page;
    range: Range;
  },
) {
  const { onlyUserId, search, pagination, range } = input;
  const source = Prisma.sql`FROM "Wallet" w JOIN "User" u ON u.id = w."userId"
    WHERE (w.balance <> 0 OR w."lockedBalance" <> 0)
    ${onlyUserId ? Prisma.sql`AND u.id = ${onlyUserId}` : Prisma.sql`AND u.role <> 'ADMIN'`}
    ${search ? Prisma.sql`AND strpos(${input.alphabetic(Prisma.sql`u.name || ' ' || u.email`)}, ${input.alphabetic(Prisma.sql`${search}::text`)}) > 0` : Prisma.empty}`;
  const [users, counts] = await Promise.all([
    db.$queryRaw<
      {
        id: string;
        name: string;
        email: string;
        balance: Prisma.Decimal;
        locked: Prisma.Decimal;
      }[]
    >(Prisma.sql`SELECT u.id, u.name, u.email, w.balance, w."lockedBalance" AS locked ${source}
      ORDER BY ${input.alphabetic(Prisma.sql`u.name`)} ASC, u.id ASC LIMIT ${pagination.pageSize} OFFSET ${pagination.skip}`),
    db.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT count(*) AS total ${source}`,
    ),
  ]);
  const total = Number(counts[0].total);
  if (!users.length)
    return {
      unit: 'cents' as const,
      data: [] as WalletPerson[],
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  const data = await walletPeople(
    db,
    users,
    Prisma.join(users.map((user) => user.id)),
    range,
  );
  return {
    unit: 'cents' as const,
    data,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

type WalletUserRow = {
  id: string;
  name: string;
  email: string;
  balance: Prisma.Decimal;
  locked: Prisma.Decimal;
};

/** Builds the per-person buckets for `users`; `scope` is the SQL list/subquery of their ids. */
async function walletPeople(
  db: Db,
  users: WalletUserRow[],
  scope: Prisma.Sql,
  range: Range,
): Promise<WalletPerson[]> {
  const inPeriod = (column: string) =>
    Prisma.sql`${Prisma.raw(column)} >= ${range.start ?? new Date(0)} AND ${Prisma.raw(column)} < ${range.end ?? new Date('9999-01-01')}`;
  // Explicit ledger tag first; legacy rows without one inherit the platform of the transaction they settle.
  const ledgerKey = ledgerKeyOf();
  const [credits, withdrawals] = await Promise.all([
    db.$queryRaw<
      {
        userId: string;
        key: string | null;
        balance: Prisma.Decimal;
        locked: Prisma.Decimal;
        period: Prisma.Decimal;
      }[]
    >(Prisma.sql`SELECT bl."userId", ${ledgerKey} AS key,
        coalesce(sum(bl."balanceDelta"), 0) AS balance, coalesce(sum(bl."lockedDelta"), 0) AS locked,
        coalesce(sum(bl."balanceDelta") FILTER (WHERE ${inPeriod('bl."createdAt"')}), 0) AS period
      FROM "BalanceLog" bl LEFT JOIN "Transaction" tx ON tx.id = bl."transactionId"
      WHERE bl."userId" IN (${scope}) AND NOT ${ownMovementSql}
      GROUP BY 1, 2`),
    db.$queryRaw<
      {
        userId: string;
        key: string | null;
        debited: Prisma.Decimal;
        pending: Prisma.Decimal;
        pendingAll: Prisma.Decimal;
        all: Prisma.Decimal;
        period: Prisma.Decimal;
      }[]
    >(Prisma.sql`SELECT "userId", ${keySql(Prisma.sql`platform`)} AS key,
        coalesce(sum("grossAmount") FILTER (WHERE status IN ('APPROVED', 'COMPLETED') AND lower(coalesce(platform, '')) <> 'atlas'), 0) AS debited,
        coalesce(sum("grossAmount") FILTER (WHERE status = 'PENDING' AND lower(coalesce(platform, '')) <> 'atlas'), 0) AS pending,
        coalesce(sum("grossAmount") FILTER (WHERE status = 'PENDING'), 0) AS "pendingAll",
        coalesce(sum("grossAmount") FILTER (WHERE status IN ('APPROVED', 'COMPLETED')), 0) AS "all",
        coalesce(sum("grossAmount") FILTER (WHERE status IN ('APPROVED', 'COMPLETED') AND ${inPeriod('"createdAt"')}), 0) AS period
      FROM "WithdrawRequest" WHERE "userId" IN (${scope})
      GROUP BY 1, 2`),
  ]);
  const tags = [
    ...new Set(
      credits.flatMap((row) =>
        row.key && row.key !== SIMINTPAY ? [row.key] : [],
      ),
    ),
  ];
  const platforms = tags.length
    ? await db.$queryRaw<{ tag: string; name: string; isActive: boolean }[]>(
        Prisma.sql`SELECT DISTINCT ON (key) key AS tag, name, "isActive" FROM (
          SELECT ${keySql(Prisma.sql`tag`)} AS key, name, "isActive" FROM "Platform") p
          WHERE key IN (${Prisma.join(tags)}) ORDER BY key, "isActive" DESC`,
      )
    : [];
  const names = new Map(platforms.map((row) => [row.tag, row]));
  const data: WalletPerson[] = users.map((user) => {
    const buckets = new Map<
      string,
      {
        balance: Prisma.Decimal;
        locked: Prisma.Decimal;
        received: Prisma.Decimal;
        withdrawn: Prisma.Decimal;
        pendingAll: Prisma.Decimal;
      }
    >();
    const bucketOf = (id: string) => {
      const value = buckets.get(id) ?? {
        balance: new Prisma.Decimal(0),
        locked: new Prisma.Decimal(0),
        received: new Prisma.Decimal(0),
        withdrawn: new Prisma.Decimal(0),
        pendingAll: new Prisma.Decimal(0),
      };
      buckets.set(id, value);
      return value;
    };
    for (const row of credits.filter((item) => item.userId === user.id)) {
      const value = bucketOf(row.key ?? NONE);
      value.balance = value.balance.plus(row.balance);
      value.locked = value.locked.plus(row.locked);
      value.received = value.received.plus(row.period);
    }
    const own = withdrawals.filter((item) => item.userId === user.id);
    // A withdrawal leaves the wallet through the platform it was requested on: approved ones are debited from
    // its balance, pending ones are reserved (locked), so the bucket is that platform's share of the wallet.
    for (const row of own) {
      // A withdrawal without a platform belongs to no bucket: it only reduces the person's wallet totals.
      if (!row.key) continue;
      const value = bucketOf(row.key);
      value.balance = value.balance.minus(row.debited);
      value.locked = value.locked.plus(row.pending);
      value.withdrawn = value.withdrawn.plus(row.period);
      value.pendingAll = value.pendingAll.plus(row.pendingAll);
    }
    const sumOwn = (pick: (row: (typeof own)[number]) => Prisma.Decimal) =>
      own.reduce((sum, row) => sum.plus(pick(row)), new Prisma.Decimal(0));
    const list: WalletBucket[] = [...buckets.entries()]
      .filter(
        ([key, value]) =>
          key !== NONE ||
          !value.balance.isZero() ||
          !value.locked.isZero() ||
          !value.received.isZero() ||
          !value.withdrawn.isZero() ||
          !value.pendingAll.isZero(),
      )
      .map(([key, value]) => {
        const registered = names.get(key);
        const kind: WalletBucketKind =
          key === NONE
            ? 'unidentified'
            : key === SIMINTPAY
              ? 'simintpay'
              : 'platform';
        return {
          key,
          kind,
          tag: key === NONE || key === SIMINTPAY ? null : key,
          name:
            kind === 'unidentified'
              ? 'Outros'
              : kind === 'simintpay'
                ? 'SimIntPay'
                : (registered?.name ?? key),
          isActive: kind === 'platform' ? (registered?.isActive ?? null) : null,
          balanceCents: cents(value.balance),
          lockedCents: cents(value.locked),
          availableCents: cents(value.balance.minus(value.locked)),
          periodReceivedCents: cents(value.received),
          periodWithdrawnCents: cents(value.withdrawn),
          pendingWithdrawalsCents: cents(value.pendingAll),
        };
      })
      .sort((a, b) => b.balanceCents - a.balanceCents);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      balanceCents: cents(user.balance),
      lockedCents: cents(user.locked),
      availableCents: cents(
        new Prisma.Decimal(user.balance).minus(user.locked),
      ),
      periodWithdrawnCents: cents(sumOwn((row) => row.period)),
      totals: {
        availableCents: cents(
          new Prisma.Decimal(user.balance).minus(user.locked),
        ),
        receivedCents: cents(
          credits
            .filter((item) => item.userId === user.id)
            .reduce((sum, row) => sum.plus(row.balance), new Prisma.Decimal(0)),
        ),
        withdrawnCents: cents(sumOwn((row) => row.all)),
        pendingWithdrawalsCents: cents(sumOwn((row) => row.pendingAll)),
      },
      platforms: list,
    };
  });
  return data;
}

/** All-time totals of every listed wallet (same population as the list), never filtered by period or search. */
export async function walletBalanceTotals(db: Db, onlyUserId?: string) {
  const scope = Prisma.sql`SELECT w."userId" FROM "Wallet" w JOIN "User" u ON u.id = w."userId"
    WHERE (w.balance <> 0 OR w."lockedBalance" <> 0)
    ${onlyUserId ? Prisma.sql`AND u.id = ${onlyUserId}` : Prisma.sql`AND u.role <> 'ADMIN'`}`;
  const [wallets, received, withdrawals] = await Promise.all([
    db.$queryRaw<{ available: Prisma.Decimal }[]>(
      Prisma.sql`SELECT coalesce(sum(balance - "lockedBalance"), 0) AS available FROM "Wallet" WHERE "userId" IN (${scope})`,
    ),
    db.$queryRaw<{ received: Prisma.Decimal }[]>(
      Prisma.sql`SELECT coalesce(sum("balanceDelta"), 0) AS received FROM "BalanceLog" bl
        WHERE "userId" IN (${scope}) AND NOT ${ownMovementSql}`,
    ),
    db.$queryRaw<{ withdrawn: Prisma.Decimal; pending: Prisma.Decimal }[]>(
      Prisma.sql`SELECT coalesce(sum("grossAmount") FILTER (WHERE status IN ('APPROVED', 'COMPLETED')), 0) AS withdrawn,
        coalesce(sum("grossAmount") FILTER (WHERE status = 'PENDING'), 0) AS pending
        FROM "WithdrawRequest" WHERE "userId" IN (${scope})`,
    ),
  ]);
  return {
    unit: 'cents' as const,
    availableCents: cents(wallets[0].available),
    receivedCents: cents(received[0].received),
    withdrawnCents: cents(withdrawals[0].withdrawn),
    pendingWithdrawalsCents: cents(withdrawals[0].pending),
  };
}

export type PlatformBalance = WalletBucket & { usersCount: number };

type BucketRow = {
  key: string;
  balance: Prisma.Decimal;
  locked: Prisma.Decimal;
  received: Prisma.Decimal;
  withdrawn: Prisma.Decimal;
  pendingAll: Prisma.Decimal;
  tag: string | null;
  platformName: string | null;
  isActive: boolean | null;
  total: bigint;
};

/**
 * Per (user, platform) buckets computed entirely in SQL, with the same attribution rules as
 * `walletPeople`: product credits by explicit tag (legacy rows inherit their transaction's platform), SimIntPay
 * margin and policy contexts in the SimIntPay pseudo-platform, unattributed credits in "Outros". Withdrawals and
 * withdrawals deducted from the platform they were requested on; other movements of the person are in no bucket.
 */
function bucketsCte(range: Range) {
  const inPeriod = (column: string) =>
    Prisma.sql`${Prisma.raw(column)} >= ${range.start ?? new Date(0)} AND ${Prisma.raw(column)} < ${range.end ?? new Date('9999-01-01')}`;
  const ledgerKey = ledgerKeyOf();
  return Prisma.sql`WITH users AS (
      SELECT w."userId" AS id, w.balance, w."lockedBalance" AS locked
      FROM "Wallet" w JOIN "User" u ON u.id = w."userId"
      WHERE (w.balance <> 0 OR w."lockedBalance" <> 0) AND u.role <> 'ADMIN'
    ), cr AS (
      SELECT bl."userId" AS uid, ${ledgerKey} AS key,
        sum(bl."balanceDelta") AS balance, sum(bl."lockedDelta") AS locked,
        coalesce(sum(bl."balanceDelta") FILTER (WHERE ${inPeriod('bl."createdAt"')}), 0) AS period
      FROM "BalanceLog" bl LEFT JOIN "Transaction" tx ON tx.id = bl."transactionId"
      WHERE bl."userId" IN (SELECT id FROM users) AND NOT ${ownMovementSql}
      GROUP BY 1, 2
    ), wd AS (
      SELECT "userId" AS uid, ${keySql(Prisma.sql`platform`)} AS key,
        coalesce(sum("grossAmount") FILTER (WHERE status IN ('APPROVED', 'COMPLETED') AND lower(coalesce(platform, '')) <> 'atlas'), 0) AS debited,
        coalesce(sum("grossAmount") FILTER (WHERE status = 'PENDING' AND lower(coalesce(platform, '')) <> 'atlas'), 0) AS pending,
        coalesce(sum("grossAmount") FILTER (WHERE status = 'PENDING'), 0) AS pending_all,
        coalesce(sum("grossAmount") FILTER (WHERE status IN ('APPROVED', 'COMPLETED') AND ${inPeriod('"createdAt"')}), 0) AS withdrawn
      FROM "WithdrawRequest" WHERE "userId" IN (SELECT id FROM users)
      GROUP BY 1, 2
    ), buckets AS (
      -- Product credits minus the withdrawals requested on the platform: its share of the wallet. Credits
      -- without a platform stay in "Outros" (the sentinel key); withdrawals without one are in no bucket.
      SELECT uid, coalesce(key, ${NONE}) AS key,
        sum(balance) AS balance, sum(locked) AS locked, sum(received) AS received,
        sum(withdrawn) AS withdrawn, sum(pending_all) AS pending_all
      FROM (
        SELECT uid, key, balance, locked, period AS received, 0::numeric AS withdrawn, 0::numeric AS pending_all FROM cr
        UNION ALL
        SELECT uid, key, -debited, pending, 0::numeric, withdrawn, pending_all FROM wd WHERE key IS NOT NULL
      ) m
      GROUP BY 1, 2
      HAVING sum(balance) <> 0 OR sum(locked) <> 0 OR sum(received) <> 0 OR sum(withdrawn) <> 0 OR sum(pending_all) <> 0
    ), platform_names AS (
      SELECT DISTINCT ON (key) key, name, "isActive" FROM (
        SELECT ${keySql(Prisma.sql`tag`)} AS key, name, "isActive" FROM "Platform") p
      WHERE key IS NOT NULL ORDER BY key, "isActive" DESC
    )`;
}

const toBucket = (row: BucketRow): WalletBucket => {
  const kind: WalletBucketKind =
    row.key === NONE
      ? 'unidentified'
      : row.key === SIMINTPAY
        ? 'simintpay'
        : 'platform';
  return {
    key: row.key,
    kind,
    tag: kind === 'platform' ? row.key : null,
    name:
      kind === 'unidentified'
        ? 'Outros'
        : kind === 'simintpay'
          ? 'SimIntPay'
          : (row.platformName ?? row.key),
    isActive: kind === 'platform' ? (row.isActive ?? null) : null,
    balanceCents: cents(row.balance),
    lockedCents: cents(row.locked),
    availableCents: cents(new Prisma.Decimal(row.balance).minus(row.locked)),
    periodReceivedCents: cents(row.received),
    periodWithdrawnCents: cents(row.withdrawn),
    pendingWithdrawalsCents: cents(row.pendingAll),
  };
};

/**
 * Platform-first view, paginated in the database: the per-person buckets are summed per platform
 * (including the SimIntPay pseudo-platform and "Outros") with GROUP BY, searched, ordered and paged in SQL.
 */
export async function walletBalanceByPlatform(
  db: Db,
  input: {
    search?: string;
    alphabetic: (value: Prisma.Sql) => Prisma.Sql;
    pagination: Page;
    range: Range;
  },
) {
  const { search, pagination } = input;
  const label = Prisma.sql`(CASE b.key WHEN ${NONE} THEN 'Outros' WHEN ${SIMINTPAY} THEN 'SimIntPay' ELSE coalesce(pn.name, b.key) END)`;
  const rows = await db.$queryRaw<(BucketRow & { usersCount: bigint })[]>(
    Prisma.sql`${bucketsCte(input.range)}
      SELECT b.key, sum(b.balance) AS balance, sum(b.locked) AS locked, sum(b.received) AS received,
        sum(b.withdrawn) AS withdrawn, sum(b.pending_all) AS "pendingAll", count(*) AS "usersCount",
        max(pn.name) AS "platformName", bool_or(pn."isActive") AS "isActive", count(*) OVER () AS total
      FROM buckets b LEFT JOIN platform_names pn ON pn.key = b.key
      ${search ? Prisma.sql`WHERE strpos(${input.alphabetic(Prisma.sql`${label} || ' ' || b.key`)}, ${input.alphabetic(Prisma.sql`${search}::text`)}) > 0` : Prisma.empty}
      GROUP BY b.key, pn.name
      ORDER BY ${input.alphabetic(label)} ASC, b.key ASC
      LIMIT ${pagination.pageSize} OFFSET ${pagination.skip}`,
  );
  return {
    unit: 'cents' as const,
    data: rows.map((row): PlatformBalance => ({
      ...toBucket(row),
      usersCount: Number(row.usersCount),
    })),
    total: rows.length ? Number(rows[0].total) : 0,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

/** Users holding balance in one platform, paginated in the database. */
export async function walletBalanceUsersOfPlatform(
  db: Db,
  input: { key: string; pagination: Page; range: Range },
) {
  const { key, pagination } = input;
  const rows = await db.$queryRaw<
    (BucketRow & { id: string; name: string; email: string })[]
  >(
    Prisma.sql`${bucketsCte(input.range)}
      SELECT u.id, u.name, u.email, b.key, b.balance, b.locked, b.received, b.withdrawn,
        b.pending_all AS "pendingAll", pn.name AS "platformName", pn."isActive" AS "isActive",
        count(*) OVER () AS total
      FROM buckets b JOIN "User" u ON u.id = b.uid LEFT JOIN platform_names pn ON pn.key = b.key
      WHERE b.key = ${key}
      ORDER BY (b.balance - b.locked) DESC, u.name ASC, u.id ASC
      LIMIT ${pagination.pageSize} OFFSET ${pagination.skip}`,
  );
  return {
    unit: 'cents' as const,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      bucket: toBucket(row),
    })),
    total: rows.length ? Number(rows[0].total) : 0,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}
