import { Prisma } from '@prisma/client';
import { applyWalletEntry } from '../wallet-ledger/wallet-ledger';

/**
 * A sale of X with an affiliate commission of Y credits at most X minus fees in total, never X + Y.
 *
 * The seller credit is computed on the owner base. When that base is the whole payment (no seller entry sent
 * before payment, FINAL_NET draft of the platform owner) the commission credit (`EBOOK_COMMISSION_CREDITED`,
 * funded by nobody) would be new money. The funding debit below moves the commission out of the credit that
 * already contains it, in the same transaction as whichever write comes last (credit or commission), so the
 * order of arrival never matters. Credits whose base already excludes the commission (the seller entry of
 * `finance/entries` with the owner amount X - Y, settlement allocations) never overflow and are never debited.
 *
 * Forward-only: it only reads rows carrying the markers written from this change on; nothing already stored is
 * rewritten.
 */
export const EBOOK_COMMISSION_FUNDED_ACTION = 'EBOOK_COMMISSION_FUNDED';
const COMMISSION_CREDITED_ACTION = 'EBOOK_COMMISSION_CREDITED';
const ORDER_MARKER = /\[ORDER:([^\]\s]+)\]/;

/** Marker on the BalanceLog of an order credit: what it was computed on and what the buyer paid. */
export type EbookOrderCreditMarker = {
  orderNumber: string;
  baseCents: number;
  paidCents: number;
};

export const ebookOrderFromDescription = (
  description: string | null | undefined,
): string | null => ORDER_MARKER.exec(description ?? '')?.[1] ?? null;

export const ebookOrderCreditMetadata = (
  marker: EbookOrderCreditMarker,
): Prisma.InputJsonObject => ({
  ebookOrderNumber: marker.orderNumber,
  ebookOrder: { ...marker },
});

const cents = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).mul(100).toDecimalPlaces(0).toNumber();

/**
 * Idempotent: recomputes the funding target of the order and posts only the missing difference.
 * Call it at the end of every transaction that writes an order credit or a commission credit.
 */
export async function fundEbookCommission(
  p: Prisma.TransactionClient,
  orderNumber: string,
): Promise<void> {
  // Serializes the two writers (payment, commission): the second one always sees the first one's rows.
  await p.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ebook-order-funding:${orderNumber}`}))`;
  const marked = (action: string) =>
    p.balanceLog.findMany({
      where: {
        action,
        metadata: { path: ['ebookOrderNumber'], equals: orderNumber },
      },
      select: {
        userId: true,
        transactionId: true,
        balanceDelta: true,
        metadata: true,
      },
    });
  const commissions = await marked(COMMISSION_CREDITED_ACTION);
  if (!commissions.length) return;
  const credits = (
    await p.balanceLog.findMany({
      where: {
        action: {
          in: [
            'EBOOK_PENDING_COMPLETED',
            'DOM_WEBHOOK_COMPLETED',
            'LINK_SETTLEMENT_COMPLETED',
            'COPRODUCTION_COMPLETED',
          ],
        },
        metadata: { path: ['ebookOrder', 'orderNumber'], equals: orderNumber },
      },
      select: { userId: true, transactionId: true, metadata: true },
    })
  )
    .map((log) => ({
      userId: log.userId,
      transactionId: log.transactionId,
      ...(log.metadata as { ebookOrder: EbookOrderCreditMarker }).ebookOrder,
    }))
    .sort((a, b) => b.baseCents - a.baseCents);
  // One payment funds the order; a second payment for the same order is an operational refund, not a funding source.
  const credit = credits[0];
  if (!credit || credit.baseCents <= 0) return;
  const commissionCents = commissions.reduce(
    (sum, log) => sum + cents(log.balanceDelta),
    0,
  );
  const overflowCents = credit.baseCents + commissionCents - credit.paidCents;
  if (overflowCents <= 0) return;
  // The whole overflow leaves the credit: total credited = paid - fees recorded on the order credit.
  const target = overflowCents;
  const already = (await marked(EBOOK_COMMISSION_FUNDED_ACTION)).reduce(
    (sum, log) => sum - cents(log.balanceDelta),
    0,
  );
  const missing = target - already;
  if (missing <= 0) return;
  await applyWalletEntry(p, {
    userId: credit.userId,
    action: EBOOK_COMMISSION_FUNDED_ACTION,
    source: 'EBOOK_COMMISSION',
    platformTag: 'EBOOK',
    nature: 'COMMISSION',
    transactionId: credit.transactionId,
    balanceDelta: new Prisma.Decimal(missing).div(100).neg(),
    metadata: { ebookOrderNumber: orderNumber },
  });
}
