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
 * SQL key of a ledger/withdrawal tag. SimIntPay margin and the reserved policy contexts (GLOBAL, SIMINTPAY,
 * CLIENT:/USER:) are the SimIntPay pseudo-platform; an empty tag stays unattributed (NULL).
 */
const keySql = (tag: Prisma.Sql) => Prisma.sql`(CASE
  WHEN nullif(btrim(${tag}), '') IS NULL THEN NULL
  WHEN upper(btrim(${tag})) IN ('SIMINTPAY', 'GLOBAL') OR upper(btrim(${tag})) ~ '^(USER|CLIENT):' THEN ${SIMINTPAY}
  WHEN upper(btrim(${tag})) = 'EBOOKSIM' THEN 'EBOOK'
  ELSE replace(upper(btrim(${tag})), '_', '-') END)`;

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
 * Wallet-first balances. The wallet is exactly SUM(BalanceLog), so a person's balance splits by ledger
 * attribution: product credits (sales, commission, coproduction, affiliate) go to the platform that
 * originated them, margin commissions to the SimIntPay pseudo-platform, and withdrawals are charged to the
 * platform they were requested for. Whatever the attribution cannot explain stays in "unidentified", so the
 * buckets always add up to the wallet.
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
  const ledgerKey = Prisma.sql`(CASE WHEN bl.action LIKE 'AFFILIATE\\_MARGIN\\_%' THEN ${SIMINTPAY} ELSE ${keySql(Prisma.sql`coalesce(nullif(btrim(bl."platformTag"), ''), tx."platformTag")`)} END)`;
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
      WHERE bl."userId" IN (${scope}) AND bl.action NOT LIKE 'WITHDRAW\\_%'
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
      [...credits, ...withdrawals].flatMap((row) =>
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
    const bucket = (key: string | null) => {
      const id = key ?? NONE;
      let value = buckets.get(id);
      if (!value) {
        value = {
          balance: new Prisma.Decimal(0),
          locked: new Prisma.Decimal(0),
          received: new Prisma.Decimal(0),
          withdrawn: new Prisma.Decimal(0),
          pendingAll: new Prisma.Decimal(0),
        };
        buckets.set(id, value);
      }
      return value;
    };
    for (const row of credits.filter((item) => item.userId === user.id)) {
      const value = bucket(row.key);
      value.balance = value.balance.plus(row.balance);
      value.locked = value.locked.plus(row.locked);
      value.received = value.received.plus(row.period);
    }
    for (const row of withdrawals.filter((item) => item.userId === user.id)) {
      const value = bucket(row.key);
      value.balance = value.balance.minus(row.debited);
      value.locked = value.locked.plus(row.pending);
      value.withdrawn = value.withdrawn.plus(row.period);
      value.pendingAll = value.pendingAll.plus(row.pendingAll);
    }
    // Everything the attribution cannot explain (legacy history, adjustments, fees) closes the wallet.
    const identified = [...buckets.entries()].filter(([key]) => key !== NONE);
    const none = bucket(null);
    none.balance = new Prisma.Decimal(user.balance).minus(
      identified.reduce(
        (sum, [, value]) => sum.plus(value.balance),
        new Prisma.Decimal(0),
      ),
    );
    none.locked = new Prisma.Decimal(user.locked).minus(
      identified.reduce(
        (sum, [, value]) => sum.plus(value.locked),
        new Prisma.Decimal(0),
      ),
    );
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
      totals: {
        availableCents: cents(
          new Prisma.Decimal(user.balance).minus(user.locked),
        ),
        receivedCents: cents(
          credits
            .filter((item) => item.userId === user.id)
            .reduce((sum, row) => sum.plus(row.balance), new Prisma.Decimal(0)),
        ),
        withdrawnCents: cents(
          withdrawals
            .filter((item) => item.userId === user.id)
            .reduce((sum, row) => sum.plus(row.all), new Prisma.Decimal(0)),
        ),
        pendingWithdrawalsCents: cents(
          withdrawals
            .filter((item) => item.userId === user.id)
            .reduce(
              (sum, row) => sum.plus(row.pendingAll),
              new Prisma.Decimal(0),
            ),
        ),
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
      Prisma.sql`SELECT coalesce(sum("balanceDelta"), 0) AS received FROM "BalanceLog"
        WHERE "userId" IN (${scope}) AND action NOT LIKE 'WITHDRAW\\_%'`,
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

export type PlatformBalance = Omit<
  WalletBucket,
  'periodReceivedCents' | 'periodWithdrawnCents'
> & {
  usersCount: number;
  periodReceivedCents: number;
  periodWithdrawnCents: number;
};

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Platform-first view: the same per-person buckets, summed per platform (including the SimIntPay
 * pseudo-platform and "Outros"). With `key`, lists the users that hold balance in that one platform.
 */
export async function walletBalanceByPlatform(
  db: Db,
  input: {
    search?: string;
    pagination: Page;
    range: Range;
    key?: string;
  },
) {
  const scope = Prisma.sql`SELECT w."userId" FROM "Wallet" w JOIN "User" u ON u.id = w."userId"
    WHERE (w.balance <> 0 OR w."lockedBalance" <> 0) AND u.role <> 'ADMIN'`;
  const users = await db.$queryRaw<WalletUserRow[]>(
    Prisma.sql`SELECT u.id, u.name, u.email, w.balance, w."lockedBalance" AS locked
      FROM "Wallet" w JOIN "User" u ON u.id = w."userId"
      WHERE (w.balance <> 0 OR w."lockedBalance" <> 0) AND u.role <> 'ADMIN'`,
  );
  const people = users.length
    ? await walletPeople(db, users, scope, input.range)
    : [];
  if (input.key) {
    const rows = people
      .flatMap((person) => {
        const bucket = person.platforms.find((item) => item.key === input.key);
        return bucket
          ? [{ id: person.id, name: person.name, email: person.email, bucket }]
          : [];
      })
      .sort(
        (a, b) =>
          b.bucket.availableCents - a.bucket.availableCents ||
          a.name.localeCompare(b.name, 'pt-BR'),
      );
    return { unit: 'cents' as const, data: rows };
  }
  const platforms = new Map<string, PlatformBalance>();
  for (const person of people)
    for (const bucket of person.platforms) {
      const current = platforms.get(bucket.key);
      if (!current) {
        platforms.set(bucket.key, { ...bucket, usersCount: 1 });
        continue;
      }
      current.usersCount += 1;
      current.balanceCents += bucket.balanceCents;
      current.lockedCents += bucket.lockedCents;
      current.availableCents += bucket.availableCents;
      current.periodReceivedCents += bucket.periodReceivedCents;
      current.periodWithdrawnCents += bucket.periodWithdrawnCents;
      current.pendingWithdrawalsCents += bucket.pendingWithdrawalsCents;
    }
  const term = fold(input.search?.trim() ?? '');
  const all = [...platforms.values()]
    .filter(
      (item) => !term || fold(`${item.name} ${item.tag ?? ''}`).includes(term),
    )
    .sort(
      (a, b) =>
        b.availableCents - a.availableCents ||
        a.name.localeCompare(b.name, 'pt-BR'),
    );
  const { page, pageSize, skip } = input.pagination;
  return {
    unit: 'cents' as const,
    data: all.slice(skip, skip + pageSize),
    total: all.length,
    page,
    pageSize,
  };
}
