import { Prisma } from '@prisma/client';
import type { Product } from './coproduction';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Read-only projection of a product's own agreement for listings; never includes other participants' identities. */
export type CoproductionInfo = {
  role: 'OWNER' | 'COPRODUCER';
  readOnly: boolean;
  participantsCount: number;
  myPercentageBps: number | null;
};

/** Products of other owners whose own agreement lists the user as a participant. */
export async function sharedProductIds(
  db: Db,
  product: Product,
  userId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<
    { productId: string }[]
  >`SELECT "productId" FROM "CoproductionAgreement"
    WHERE product = ${product} AND mode = 'OWN' AND participants @> ${JSON.stringify([{ userId }])}::jsonb`;
  return rows.map((row) => row.productId);
}

/** Keyed by product id; products without active participants are absent. */
export async function coproductionInfo(
  db: Db,
  product: Product,
  userId: string,
  items: { id: string; userId?: string | null }[],
): Promise<Map<string, CoproductionInfo>> {
  const info = new Map<string, CoproductionInfo>();
  if (!items.length) return info;
  const rows = await db.$queryRaw<
    {
      productId: string;
      participants: { userId: string; percentageBps: number }[];
    }[]
  >(Prisma.sql`SELECT "productId", participants
    FROM "CoproductionAgreement" WHERE product = ${product} AND mode = 'OWN' AND "productId" IN (${Prisma.join(items.map((item) => item.id))})`);
  for (const row of rows) {
    if (!row.participants.length) continue;
    const item = items.find((candidate) => candidate.id === row.productId)!;
    const mine = row.participants.find(
      (participant) => participant.userId === userId,
    );
    if (item.userId === userId)
      info.set(row.productId, {
        role: 'OWNER',
        readOnly: false,
        participantsCount: row.participants.length,
        myPercentageBps: null,
      });
    else if (mine)
      info.set(row.productId, {
        role: 'COPRODUCER',
        readOnly: true,
        participantsCount: row.participants.length,
        myPercentageBps: mine.percentageBps,
      });
  }
  return info;
}

export type CoproductionTransactionInfo = {
  role: 'OWNER' | 'COPRODUCER';
  readOnly: boolean;
  product: string | null;
  myAmountCents: number | null;
  state: string | null;
};

/** Flags transactions the user sees through a coproduction allocation (not as seller). */
export async function transactionCoproductionInfo(
  db: Db,
  userId: string,
  transactions: { id: string; userId: string; financialSnapshot?: unknown }[],
): Promise<Map<string, CoproductionTransactionInfo>> {
  const info = new Map<string, CoproductionTransactionInfo>();
  if (!transactions.length) return info;
  const rows = await db.$queryRaw<
    { transactionId: string; amount: Prisma.Decimal; state: string }[]
  >(Prisma.sql`SELECT "transactionId", amount, state
    FROM "CoproductionAllocation" WHERE "userId" = ${userId} AND "transactionId" IN (${Prisma.join(transactions.map((t) => t.id))})`);
  const allocations = new Map(rows.map((row) => [row.transactionId, row]));
  const productOf = (snapshot: unknown) => {
    const value = (snapshot as { coproduction?: { product?: unknown } } | null)
      ?.coproduction?.product;
    return typeof value === 'string' ? value : null;
  };
  for (const transaction of transactions) {
    const allocation = allocations.get(transaction.id);
    const hasCoproduction = Boolean(productOf(transaction.financialSnapshot));
    if (transaction.userId === userId) {
      if (hasCoproduction)
        info.set(transaction.id, {
          role: 'OWNER',
          readOnly: false,
          product: productOf(transaction.financialSnapshot),
          myAmountCents: allocation
            ? new Prisma.Decimal(allocation.amount).mul(100).toNumber()
            : null,
          state: allocation?.state ?? null,
        });
    } else if (allocation) {
      info.set(transaction.id, {
        role: 'COPRODUCER',
        readOnly: true,
        product: productOf(transaction.financialSnapshot),
        myAmountCents: new Prisma.Decimal(allocation.amount)
          .mul(100)
          .toNumber(),
        state: allocation.state,
      });
    }
  }
  return info;
}

export async function coproductionTotals(
  db: Db,
  userId: string,
  range?: { start: Date; end: Date },
) {
  const period = range
    ? Prisma.sql`AND a."createdAt" BETWEEN ${range.start} AND ${range.end}`
    : Prisma.empty;
  const [row] = await db.$queryRaw<
    {
      count: bigint;
      available: Prisma.Decimal;
      locked: Prisma.Decimal;
      reversed: Prisma.Decimal;
    }[]
  >(Prisma.sql`SELECT count(*) AS count,
    coalesce(sum(a.amount) FILTER (WHERE a.state = 'AVAILABLE'), 0) AS available,
    coalesce(sum(a.amount) FILTER (WHERE a.state = 'LOCKED'), 0) AS locked,
    coalesce(sum(a.amount) FILTER (WHERE a.state = 'REVERSED'), 0) AS reversed
    FROM "CoproductionAllocation" a JOIN "Transaction" t ON t.id = a."transactionId" WHERE a."userId" = ${userId} AND t."userId" <> ${userId} ${period}`);
  const cents = (amount: Prisma.Decimal) =>
    new Prisma.Decimal(amount).mul(100).toNumber();
  return {
    count: Number(row.count),
    creditedCents: cents(row.available),
    lockedCents: cents(row.locked),
    reversedCents: cents(row.reversed),
  };
}
