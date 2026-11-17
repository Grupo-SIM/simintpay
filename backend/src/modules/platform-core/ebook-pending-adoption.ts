import { PaymentMethod, TransactionStatus } from '@prisma/client';
import { Acquirer } from '../../core/services/acquirer.enum';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { transactionPlatformTag } from './transaction-platform';

/** `domPaymentId` of the seller entry recorded by `POST .../finance/entries` (`kind: pending`). */
export const EBOOK_PENDING_PREFIX = 'EBOOK_PENDING_';

/**
 * Seller entry (canonical `finance/entries` pending) that the public checkout may pay for a non-manifest order.
 *
 * Without a manifest nothing else credits the seller: the checkout used to create a separate FINAL_NET draft
 * under the platform owner and the entry stayed PENDING forever. Adopting the entry means the real payment is
 * bound to it (acquirer + `externalPaymentId`) and the DOM webhook completes it, exactly once, through the
 * status-conditional completion in `ProcessDomWebhookUseCase.completeEbookPending`.
 *
 * Never adopted: manifest orders (`EbookSettlement` row or `settlementId`, `settlementBasis` EBOOK_V1 credits
 * the allocations itself), non-EBOOK stores, entries not priced by the server (no snapshot), entries already
 * past PENDING, and entries whose owner amount exceeds the order total.
 */
export async function findAdoptableEbookEntry(
  prisma: PrismaService,
  input: {
    store?: string;
    orderNumber?: string | null;
    settlementId?: string;
    price: number;
  },
): Promise<{ id: string } | null> {
  const orderNumber = input.orderNumber?.trim();
  if (
    !orderNumber ||
    input.settlementId ||
    (input.store ?? 'ebook').toUpperCase() !== 'EBOOK'
  )
    return null;
  const manifest = await prisma.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "EbookSettlement" WHERE "orderNumber" = ${orderNumber} LIMIT 1`;
  if (manifest.length) return null;
  const entry = await prisma.transaction.findUnique({
    where: { domPaymentId: `${EBOOK_PENDING_PREFIX}${orderNumber}` },
    select: {
      id: true,
      status: true,
      settlementBasis: true,
      platformTag: true,
      financialSnapshot: true,
      netAmount: true,
      amount: true,
    },
  });
  if (
    !entry ||
    entry.status !== TransactionStatus.PENDING ||
    entry.settlementBasis !== null ||
    transactionPlatformTag(entry) !== 'EBOOK' ||
    !entry.financialSnapshot ||
    entry.netAmount === null ||
    Math.round(Number(entry.amount) * 100) > Math.round(input.price * 100)
  )
    return null;
  return { id: entry.id };
}

/**
 * Records the real payment on the adopted entry. Conditional on the entry still being PENDING and unsettled:
 * if the webhook already completed it (payment confirmed before this write) nothing is touched. The entry keeps
 * its `EBOOK_PENDING_` key so a replayed `finance/entries` call finds it instead of creating a second entry;
 * amount, net and fees are only written by the webhook completion, from what the buyer really paid.
 */
export async function bindAdoptedEbookEntry(
  prisma: PrismaService,
  entryId: string,
  payment: {
    externalPaymentId: string;
    acquirer: Acquirer;
    method: 'PIX' | 'CREDIT_CARD';
    installments: number;
  },
): Promise<boolean> {
  const bound = await prisma.transaction.updateMany({
    where: {
      id: entryId,
      status: TransactionStatus.PENDING,
      settlementBasis: null,
      domPaymentId: { startsWith: EBOOK_PENDING_PREFIX },
    },
    data: {
      acquirer: payment.acquirer,
      externalPaymentId: payment.externalPaymentId,
      paymentMethod:
        payment.method === 'PIX'
          ? PaymentMethod.PIX
          : PaymentMethod.CREDIT_CARD,
      installments: payment.installments,
    },
  });
  return bound.count === 1;
}
