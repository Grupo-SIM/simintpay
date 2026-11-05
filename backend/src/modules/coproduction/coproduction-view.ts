import { canonicalTransactionPlatformTag } from '../platform-core/transaction-platform';
import { Prisma } from '@prisma/client';
import {
  productOwnerColumn,
  productTables,
  type Product,
} from './coproduction';

/** Match settlement inheritance, including an explicit empty OWN override. */
function effectiveAgreements(product: Product) {
  if (product === 'plataformas')
    return Prisma.sql`SELECT "productId", participants FROM "CoproductionAgreement" WHERE product = ${product} AND mode = 'OWN'`;
  const table = Prisma.raw(`"${productTables[product]}"`);
  const tag = Prisma.raw(
    product === 'planos-pix'
      ? 'p."tenantTag"'
      : product === 'links-assinatura'
        ? 'coalesce(p."platformTag", p.plataformas[1])'
        : product === 'ofertas'
          ? 'p."platformTag"'
          : 'p.plataformas[1]',
  );
  const owner = Prisma.raw(`p."${productOwnerColumn(product)}"`);
  return Prisma.sql`SELECT p.id AS "productId", CASE WHEN own.mode = 'OWN' THEN own.participants ELSE inherited.participants END AS participants
    FROM ${table} p JOIN "User" u ON u.id = ${owner}
    LEFT JOIN "Platform" fallback ON fallback.id = u."platformId"
    LEFT JOIN "CoproductionAgreement" own ON own.product = ${product} AND own."productId" = p.id
    LEFT JOIN "Platform" platform ON platform.tag = coalesce(${tag}, fallback.tag) AND platform."ownerUserId" = ${owner}
    LEFT JOIN "CoproductionAgreement" inherited ON inherited.product = 'plataformas' AND inherited."productId" = platform.id AND inherited.mode = 'OWN'`;
}

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Read-only projection of the effective agreement; never includes other participants' identities. */
export type CoproductionInfo = {
  role: 'OWNER' | 'COPRODUCER';
  readOnly: boolean;
  participantsCount: number;
  myPercentageBps: number | null;
};

/** Products whose effective agreement lists the user as a participant. */
export async function sharedProductIds(
  db: Db,
  product: Product,
  userId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<
    { productId: string }[]
  >(Prisma.sql`SELECT "productId" FROM (${effectiveAgreements(product)}) effective
    WHERE participants @> ${JSON.stringify([{ userId }])}::jsonb`);
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
    FROM (${effectiveAgreements(product)}) effective WHERE "productId" IN (${Prisma.join(items.map((item) => item.id))}) AND participants IS NOT NULL`);
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
  range?: {
    start?: Date;
    end?: Date;
    platform?: string;
    paymentMethod?: string;
  },
) {
  const period = Prisma.sql`
    ${range?.start ? Prisma.sql`AND t."createdAt" >= ${range.start}` : Prisma.empty}
    ${range?.end ? Prisma.sql`AND t."createdAt" <= ${range.end}` : Prisma.empty}
    ${range?.platform ? Prisma.sql`AND t."platformTag" = ${canonicalTransactionPlatformTag(range.platform)}` : Prisma.empty}
    ${range?.paymentMethod ? Prisma.sql`AND t."paymentMethod"::text = ${range.paymentMethod}` : Prisma.empty}`;
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
