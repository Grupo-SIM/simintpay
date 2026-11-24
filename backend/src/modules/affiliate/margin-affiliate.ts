import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  effectivePercentage,
  validateAffiliateInput,
  type AffiliateConfig,
  type AffiliateInput,
  type AffiliateProduct,
  type AffiliateSnapshot,
} from './affiliate';

/** Margin affiliate frozen in the sale snapshot; paid from SimIntPay's margin, never from the owner. */
export type MarginAffiliateSnapshot = Omit<AffiliateSnapshot, 'deduplication'>;

export type MarginCoproducer = { userId: string; percentageBps: number };
/** Regular affiliate shape (no link base URL) plus the fixed margin coproducers of the scope. */
export type MarginAffiliateConfig = AffiliateConfig & {
  coproducers: MarginCoproducer[];
};
export type MarginAffiliateInput = Omit<AffiliateInput, 'linkBaseUrl'> & {
  coproducers: { email: string; percentageBps: number }[];
};

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

export function validateMarginInput(
  body: unknown,
  product: AffiliateProduct,
): MarginAffiliateInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Configuração inválida');
  const { coproducers: raw, ...rest } = body as Record<string, unknown>;
  const base = validateAffiliateInput(rest, product);
  const list = raw ?? [];
  if (!Array.isArray(list) || list.length > 100)
    throw new BadRequestException('Configuração inválida');
  const seen = new Set<string>();
  const coproducers = list.map((entry) => {
    const c = entry as { email?: unknown; percentageBps?: unknown };
    if (
      !c ||
      typeof c.email !== 'string' ||
      !Number.isInteger(c.percentageBps) ||
      (c.percentageBps as number) < 1 ||
      (c.percentageBps as number) > 10000
    )
      throw new BadRequestException('Coprodutor inválido');
    const email = c.email.trim().toLowerCase();
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      seen.has(email)
    )
      throw new BadRequestException('E-mail inválido ou duplicado');
    seen.add(email);
    return { email, percentageBps: c.percentageBps as number };
  });
  if (coproducers.reduce((sum, c) => sum + c.percentageBps, 0) > 10000)
    throw new BadRequestException(
      'A soma dos coprodutores da margem não pode ultrapassar 100%',
    );
  const { linkBaseUrl: _link, ...input } = base;
  return { ...input, coproducers };
}

/**
 * Coproducers of a sale: platform and offer lists add up and the offer percentage wins for the
 * same person.
 */
export function effectiveCoproducers(
  offer: { coproducers: MarginCoproducer[] } | null,
  platform: { coproducers: MarginCoproducer[] } | null,
): MarginCoproducer[] {
  const own = offer?.coproducers ?? [];
  const ids = new Set(own.map((c) => c.userId));
  return [
    ...own,
    ...(platform?.coproducers ?? []).filter((c) => !ids.has(c.userId)),
  ];
}

/**
 * Worst total any sale of this scope pair can carry over the margin: all coproducers plus the
 * best-paid affiliate who is not also a coproducer (one share per person; the coproducer wins).
 */
export function marginWorstCaseBps(
  offer: MarginAffiliateConfig | null,
  platform: MarginAffiliateConfig | null,
): number {
  const coproducers = effectiveCoproducers(offer, platform);
  const base = coproducers.reduce((sum, c) => sum + c.percentageBps, 0);
  const taken = new Set(coproducers.map((c) => c.userId));
  const ids = new Set([
    ...(offer?.affiliates ?? []).map((a) => a.userId),
    ...(platform?.affiliates ?? []).map((a) => a.userId),
  ]);
  let best = 0;
  for (const userId of ids) {
    if (taken.has(userId)) continue;
    best = Math.max(
      best,
      effectivePercentage(userId, offer, platform)?.percentageBps ?? 0,
    );
  }
  return base + best;
}
