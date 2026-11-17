import { ChargeStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

/**
 * Plan 0023, phase 3: AreaFlix subscription sales through `Offer`. The legacy admin screens picked subscription links whose
 * `webhookUrl` contained "areaflix"; the offer equivalent is a recurring offer of the AREAFLIX
 * platform. A paid `SubscriptionLinkOrder` is a `Charge` (`PAID`), listed in the legacy order shape.
 */
type Db = Pick<PrismaService, 'offer' | 'charge'>;

const PAID_ORDER_STATUSES = ['paid', 'active', 'approved'];
const LEGACY_STATUS: Record<ChargeStatus, string> = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

export async function areaflixOfferIds(db: Db): Promise<string[]> {
  const offers = await db.offer.findMany({
    where: { platformTag: 'AREAFLIX', renewalMode: { not: 'NONE' } },
    select: { id: true },
  });
  return offers.map((o) => o.id);
}

/** Legacy order status filter to charge statuses (`paid`, `active` and `approved` all mean paid). */
export function chargeStatusesOf(status: string): ChargeStatus[] {
  const value = status.trim().toLowerCase();
  if (PAID_ORDER_STATUSES.includes(value)) return ['PAID'];
  return (Object.keys(LEGACY_STATUS) as ChargeStatus[]).filter(
    (key) => LEGACY_STATUS[key] === value,
  );
}

/** Emails that bought a paid AreaFlix subscription. */
export async function paidAreaflixEmails(
  db: Db,
  emails: string[],
): Promise<Set<string>> {
  const ids = await areaflixOfferIds(db);
  if (!ids.length) return new Set();
  const rows = await db.charge.findMany({
    where: {
      offerId: { in: ids },
      customerEmail: { in: emails },
      status: 'PAID',
    },
    select: { customerEmail: true },
    distinct: ['customerEmail'],
  });
  return new Set(
    rows.flatMap((row) => (row.customerEmail ? [row.customerEmail] : [])),
  );
}

export async function listAreaflixOfferOrders(
  db: Db,
  input: {
    skip: number;
    take: number;
    status?: string;
    customerEmail?: string;
    customerName?: string;
  },
) {
  const ids = await areaflixOfferIds(db);
  const where: Prisma.ChargeWhereInput = { offerId: { in: ids } };
  if (input.status) where.status = { in: chargeStatusesOf(input.status) };
  if (input.customerEmail)
    where.customerEmail = {
      contains: input.customerEmail,
      mode: 'insensitive',
    };
  if (input.customerName)
    where.customerName = { contains: input.customerName, mode: 'insensitive' };
  const [total, charges, paid] = await Promise.all([
    db.charge.count({ where }),
    db.charge.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: input.skip,
      take: input.take,
      include: {
        offer: {
          select: { name: true, amountCents: true, intervalType: true },
        },
        transaction: { select: { platformFee: true } },
      },
    }),
    db.charge.findMany({
      where: { offerId: { in: ids }, status: 'PAID' },
      select: {
        amountCents: true,
        transaction: { select: { platformFee: true } },
      },
    }),
  ]);
  const items = charges.map((charge) => ({
    id: charge.id,
    subscriptionLinkId: charge.offerId,
    customerName: charge.customerName,
    customerEmail: charge.customerEmail,
    customerDocument: charge.customerDocument,
    paymentMethod: charge.method,
    status: LEGACY_STATUS[charge.status],
    amountCharged: charge.amountCents / 100,
    platformFeeAmount: Number(charge.transaction?.platformFee ?? 0),
    createdAt: charge.createdAt,
    subscriptionLink: charge.offer && {
      name: charge.offer.name,
      amount: charge.offer.amountCents / 100,
      platformFee: null,
      frequencyType: charge.offer.intervalType,
    },
  }));
  return {
    total,
    items,
    totalRevenue: paid.reduce((sum, row) => sum + row.amountCents / 100, 0),
    totalFee: paid.reduce(
      (sum, row) => sum + Number(row.transaction?.platformFee ?? 0),
      0,
    ),
  };
}
