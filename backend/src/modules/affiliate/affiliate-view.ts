import { Prisma } from '@prisma/client';
import { affiliateAmount, snapshotFrom } from '../coproduction/coproduction';
import {
  coproductionPeriod,
  type CoproductionRange,
} from '../coproduction/coproduction-view';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

const cents = (amount: Prisma.Decimal.Value) =>
  new Prisma.Decimal(amount).mul(100).toNumber();

/** Platforms where the user is a listed affiliate, on the platform agreement or on one of its offers. */
export async function affiliatePlatformIds(
  db: Db,
  userId: string,
): Promise<string[]> {
  const listed = JSON.stringify([{ userId }]);
  const rows = await db.$queryRaw<
    { id: string }[]
  >(Prisma.sql`SELECT "productId" AS id FROM "AffiliateAgreement"
    WHERE product = 'plataformas' AND affiliates @> ${listed}::jsonb
    UNION
    SELECT p.id FROM "AffiliateAgreement" a
    JOIN "Offer" o ON o.id = a."productId"
    JOIN "Platform" p ON p.tag = o."platformTag" AND p."ownerUserId" = o."ownerUserId"
    WHERE a.product = 'ofertas' AND a.affiliates @> ${listed}::jsonb
    UNION
    SELECT "productId" AS id FROM "MarginAffiliateAgreement"
    WHERE product = 'plataformas'
      AND (affiliates @> ${listed}::jsonb OR coproducers @> ${listed}::jsonb)
    UNION
    SELECT p.id FROM "MarginAffiliateAgreement" a
    JOIN "Offer" o ON o.id = a."productId"
    JOIN "Platform" p ON p.tag = o."platformTag" AND p."ownerUserId" = o."ownerUserId"
    WHERE a.product = 'ofertas'
      AND (a.affiliates @> ${listed}::jsonb OR a.coproducers @> ${listed}::jsonb)`);
  return rows.map((row) => row.id);
}

/** Platforms hosting an offer whose effective coproduction agreement lists the user. */
export async function coproducedOfferPlatformIds(
  db: Db,
  offerIds: string[],
): Promise<string[]> {
  if (!offerIds.length) return [];
  const rows = await db.$queryRaw<
    { id: string }[]
  >(Prisma.sql`SELECT DISTINCT p.id FROM "Offer" o
    JOIN "Platform" p ON p.tag = o."platformTag" AND p."ownerUserId" = o."ownerUserId"
    WHERE o.id IN (${Prisma.join(offerIds)})`);
  return rows.map((row) => row.id);
}

/** Past commissions of the user (as affiliate) on sales of someone else tagged with the platform. */
export async function hasAffiliateHistory(
  db: Db,
  userId: string,
  platformTag: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<
    { count: bigint }[]
  >(Prisma.sql`SELECT count(*) AS count FROM "AffiliateAllocation" a JOIN "Transaction" t ON t.id = a."transactionId"
    WHERE a."userId" = ${userId} AND t."userId" <> ${userId} AND t."platformTag" = ${platformTag}`);
  if (Number(rows[0]?.count ?? 0) > 0) return true;
  const margin = await db.$queryRaw<
    { count: bigint }[]
  >(Prisma.sql`SELECT count(*) AS count FROM "MarginAffiliateAllocation" a JOIN "Transaction" t ON t.id = a."transactionId"
    WHERE a."userId" = ${userId} AND t."userId" <> ${userId} AND t."platformTag" = ${platformTag}`);
  return Number(margin[0]?.count ?? 0) > 0;
}

/** Read-only marker of a platform listed for someone who is only an affiliate there. */
export type AffiliatePlatformInfo = { role: 'AFFILIATE'; readOnly: true };

export type AffiliateTotals = {
  count: number;
  creditedCents: number;
  lockedCents: number;
  reversedCents: number;
};

/**
 * Own commissions on sales of other owners, as affiliate or as participant of the SimIntPay margin
 * (affiliate or coproducer); informative, already part of the wallet.
 */
export async function affiliateTotals(
  db: Db,
  userId: string,
  range?: CoproductionRange,
): Promise<AffiliateTotals> {
  const rows = await db.$queryRaw<
    { state: string; count: bigint; amount: Prisma.Decimal }[]
  >(Prisma.sql`SELECT a.state::text AS state, count(*) AS count, coalesce(sum(a.amount), 0) AS amount
    FROM (
      SELECT "transactionId", "userId", state, amount FROM "AffiliateAllocation"
      UNION ALL
      SELECT "transactionId", "userId", state, amount FROM "MarginAffiliateAllocation"
    ) a JOIN "Transaction" t ON t.id = a."transactionId"
    WHERE a."userId" = ${userId} AND t."userId" <> ${userId} ${coproductionPeriod(range)}
    GROUP BY 1`);
  const state = (name: string) =>
    cents(
      rows
        .filter((row) => row.state === name)
        .reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0)),
    );
  return {
    count: rows.reduce((total, row) => total + Number(row.count), 0),
    creditedCents: state('AVAILABLE'),
    lockedCents: state('LOCKED'),
    reversedCents: state('REVERSED'),
  };
}

export type OwnerAffiliateTotals = { count: number; commissionCents: number };

/**
 * What the owner paid to affiliates on credited sales of the scope. `source` is a query that exposes
 * the sale ids as `id`; the owner net of those sales already excludes this amount.
 */
export async function ownerAffiliateTotals(
  db: Db,
  source: Prisma.Sql,
): Promise<OwnerAffiliateTotals> {
  const rows = await db.$queryRaw<
    { count: bigint; amount: Prisma.Decimal }[]
  >(Prisma.sql`SELECT count(*) AS count, coalesce(sum(a.amount), 0) AS amount
    FROM "AffiliateAllocation" a JOIN (${source}) scoped ON scoped.id = a."transactionId"
    WHERE a.state::text = 'AVAILABLE'`);
  return {
    count: Number(rows[0]?.count ?? 0),
    commissionCents: cents(rows[0]?.amount ?? 0),
  };
}

/** Owner's own sales of the period (any platform), for dashboards without a platform scope. */
export function ownerSalesSource(userId: string, range?: CoproductionRange) {
  return Prisma.sql`SELECT t.id FROM "Transaction" t WHERE t."userId" = ${userId} ${coproductionPeriod(range)}`;
}

export type AffiliateTransactionInfo = {
  role: 'OWNER' | 'AFFILIATE';
  readOnly: boolean;
  myAmountCents: number | null;
  state: string | null;
  isRenewal: boolean;
  /** Affiliate only: where the commission comes from (the sale's net or the SimIntPay margin). */
  basis?: 'PRODUCT' | 'MARGIN' | 'BOTH';
  /** Owner only: commission paid to the affiliate of the sale. */
  affiliateCommissionCents?: number | null;
  /** Owner only: public code of the affiliate, never an e-mail. */
  affiliateCode?: string | null;
};

type SnapshotAffiliate = { code?: unknown; isRenewal?: unknown } | undefined;

function snapshotAffiliate(snapshot: unknown): SnapshotAffiliate {
  return (
    snapshot as {
      coproduction?: { affiliate?: SnapshotAffiliate };
    } | null
  )?.coproduction?.affiliate;
}

/** Flags transactions with an affiliate commission, seen by the owner or by the affiliate. */
export async function transactionAffiliateInfo(
  db: Db,
  userId: string,
  transactions: {
    id: string;
    userId: string;
    netAmount?: Prisma.Decimal | null;
    financialSnapshot?: unknown;
  }[],
): Promise<Map<string, AffiliateTransactionInfo>> {
  const info = new Map<string, AffiliateTransactionInfo>();
  if (!transactions.length) return info;
  const rows = await db.$queryRaw<
    {
      transactionId: string;
      userId: string;
      amount: Prisma.Decimal;
      state: string;
      isRenewal: boolean;
    }[]
  >(Prisma.sql`SELECT "transactionId", "userId", amount, state, "isRenewal"
    FROM "AffiliateAllocation" WHERE "transactionId" IN (${Prisma.join(transactions.map((t) => t.id))})`);
  const marginRows = await db.$queryRaw<
    {
      transactionId: string;
      amount: Prisma.Decimal;
      state: string;
      isRenewal: boolean;
    }[]
  >(Prisma.sql`SELECT "transactionId", amount, state, "isRenewal"
    FROM "MarginAffiliateAllocation" WHERE "userId" = ${userId} AND "transactionId" IN (${Prisma.join(transactions.map((t) => t.id))})`);
  for (const transaction of transactions) {
    const allocation = rows.find((row) => row.transactionId === transaction.id);
    if (transaction.userId === userId) {
      const fromSnapshot = snapshotAffiliate(transaction.financialSnapshot);
      if (!allocation && !fromSnapshot) continue;
      let commission: number | null = allocation
        ? cents(allocation.amount)
        : null;
      if (commission === null && transaction.netAmount != null) {
        try {
          const snapshot = snapshotFrom(
            transaction.financialSnapshot as Prisma.JsonValue,
          );
          if (snapshot)
            commission = cents(
              affiliateAmount(
                snapshot,
                new Prisma.Decimal(transaction.netAmount),
              ),
            );
        } catch {
          commission = null;
        }
      }
      info.set(transaction.id, {
        role: 'OWNER',
        readOnly: false,
        myAmountCents: null,
        state: allocation?.state ?? null,
        isRenewal: Boolean(allocation?.isRenewal ?? fromSnapshot?.isRenewal),
        affiliateCommissionCents: commission,
        affiliateCode:
          typeof fromSnapshot?.code === 'string' ? fromSnapshot.code : null,
      });
    } else {
      const product = allocation?.userId === userId ? allocation : undefined;
      const margin = marginRows.find(
        (row) => row.transactionId === transaction.id,
      );
      if (!product && !margin) continue;
      info.set(transaction.id, {
        role: 'AFFILIATE',
        readOnly: true,
        myAmountCents: cents(product?.amount ?? 0) + cents(margin?.amount ?? 0),
        state: (product ?? margin)!.state,
        isRenewal: Boolean(product?.isRenewal || margin?.isRenewal),
        basis: product && margin ? 'BOTH' : margin ? 'MARGIN' : 'PRODUCT',
      });
    }
  }
  return info;
}

const BUYER_FIELDS = [
  'customerName',
  'customerEmail',
  'customerDocument',
  'customerPhone',
  'pixQrCode',
  'pixContent',
  'cardBrand',
  'cardBin',
  'cardCodeAuth',
] as const;

/** Affiliates see their commission and the SimIntPay fee (`totalFee`), never the buyer or the owner's other financials. */
export function redactForAffiliate<T extends Record<string, unknown>>(
  transaction: T,
): T {
  const result: Record<string, unknown> = { ...transaction };
  for (const field of BUYER_FIELDS) if (field in result) result[field] = null;
  for (const field of ['netAmount', 'acquirerFee', 'platformFee'] as const)
    if (field in result) result[field] = field === 'netAmount' ? null : '0';
  return result as T;
}

/** Order projection of the detail endpoint reduced to what an affiliate may see. */
export function affiliateOrder(order: Record<string, unknown> | null) {
  if (!order) return order;
  const allowed = [
    'date_register',
    'historic_status',
    'id_transaction',
    'items',
    'origin',
    'paid_date',
    'total',
    'type',
    'type_payment',
  ];
  return Object.fromEntries(
    allowed.filter((key) => key in order).map((key) => [key, order[key]]),
  );
}
