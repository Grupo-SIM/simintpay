import { Prisma } from '@prisma/client';
import type { AffiliateConfig, AffiliateSnapshot } from './affiliate';

/** Margin affiliate frozen in the sale snapshot; paid from SimIntPay's margin, never from the owner. */
export type MarginAffiliateSnapshot = Omit<AffiliateSnapshot, 'deduplication'>;

/** Same shape as a regular configuration; the link base URL does not exist for margin affiliates. */
export type MarginAffiliateConfig = AffiliateConfig;

const cents = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

/**
 * SimIntPay margin of one sale in cents: buyer total − merchant net − realized acquirer cost.
 * Zero when the realized cost is still unknown or the sale lost money; never negative.
 */
export function marginCents(
  financialSnapshot: unknown,
  amount: Prisma.Decimal.Value,
  netAmount: Prisma.Decimal.Value | null | undefined,
): number {
  if (netAmount == null) return 0;
  const snapshot =
    financialSnapshot &&
    typeof financialSnapshot === 'object' &&
    !Array.isArray(financialSnapshot)
      ? (financialSnapshot as Record<string, unknown>)
      : {};
  const cost = snapshot.acquirerCost as { realizedCents?: unknown } | undefined;
  const realized = cents(cost?.realizedCents);
  if (realized === undefined) return 0;
  const buyer =
    cents(snapshot.buyerTotalCents) ??
    new Prisma.Decimal(amount).mul(100).round().toNumber();
  const margin = new Prisma.Decimal(buyer)
    .sub(new Prisma.Decimal(netAmount).mul(100).round())
    .sub(realized);
  return margin.isPositive() ? margin.toNumber() : 0;
}

/** Commission in reais: whole-cent floor of the percentage of the margin. */
export function marginCommission(
  marginInCents: number,
  percentageBps: number,
): Prisma.Decimal {
  return new Prisma.Decimal(marginInCents)
    .mul(percentageBps)
    .div(10000)
    .floor()
    .div(100);
}
