import {
  Prisma,
  type Charge,
  type Offer,
  type PaymentMethod,
} from '@prisma/client';
import { round2 } from '../../application/use-cases/payment-link/payment-link-fees.helper';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../financial-policy/financial-charge';
import { BadRequestException } from '@nestjs/common';

export type CyclePolicyContext = Awaited<ReturnType<typeof loadChargePolicy>>;

/** Buyer total, seller net and fee split of one offer charge (first charge or any later cycle). */
export type CycleQuote = {
  platformTag: string;
  /** Policy tag the quote was priced under. */
  policyTag: string;
  method: PaymentMethod;
  installments: number;
  /** Base (seller) price in cents the quote started from. */
  baseAmountCents: number;
  /** What the buyer pays. */
  totalAmount: number;
  interestAmount?: number;
  netAmount: number;
  domFee: number;
  totalFee: number;
  platformFee: number;
  financialSnapshot: Prisma.InputJsonValue | undefined;
};

/** Current platform policy used for new offer charges. */
export function cyclePolicyTag(
  offer: Pick<Offer, 'platformTag' | 'ownerUserId'>,
): string {
  return (offer.platformTag ?? 'GLOBAL').toUpperCase();
}

/** Method a recurring cycle is charged with when the buyer has not chosen one. */
export function defaultCycleMethod(
  offer: Pick<Offer, 'renewalMode' | 'acceptedMethods'>,
): PaymentMethod {
  return offer.renewalMode === 'AUTO_CHARGE'
    ? 'CREDIT_CARD'
    : (offer.acceptedMethods[0] ?? 'PIX');
}

/** Loads the policy context to price an offer at `at` (default: now). */
export function loadCyclePolicyContext(
  prisma: Parameters<typeof loadChargePolicy>[0],
  offer: Pick<Offer, 'platformTag' | 'ownerUserId'>,
  at?: Date,
): Promise<CyclePolicyContext> {
  return loadChargePolicy(prisma, cyclePolicyTag(offer), at);
}

/**
 * The single pricing rule for an offer charge: the current financial policy. Pure given the already loaded policy context. The first subscription
 * charge and every later cycle use this, so the buyer total never drifts between cycles.
 */
export function quoteOfferCycle(
  context: CyclePolicyContext,
  offer: Pick<Offer, 'platformTag' | 'ownerUserId' | 'amountCents'>,
  method: PaymentMethod,
  installments = 1,
): CycleQuote {
  const platformTag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
  const isPix = method === 'PIX';
  const isDebit = method === 'DEBIT_CARD';
  const taxaTag = cyclePolicyTag(offer);
  const effectiveInstallments = isPix || isDebit ? 1 : installments;
  const financialMethod = isPix
    ? 'PIX'
    : isDebit
      ? 'DEBIT_CARD'
      : 'CREDIT_CARD';
  const baseAmount = offer.amountCents / 100;
  const financialQuote = quoteFinancialCharge(
    context,
    baseAmount,
    financialMethod,
    effectiveInstallments,
    'ONLINE',
    false,
  );
  if (!financialQuote) {
    throw new BadRequestException(
      'Taxas da plataforma não configuradas para esta modalidade',
    );
  }
  const { totalAmount, domFeeAmount, netAmount } = financialQuote;
  const domFee = round2(domFeeAmount);
  const totalFee = round2(totalAmount - netAmount);
  return {
    platformTag,
    policyTag: taxaTag,
    method,
    installments: effectiveInstallments,
    baseAmountCents: offer.amountCents,
    totalAmount,
    interestAmount: financialQuote.interestAmount ?? 0,
    netAmount,
    domFee,
    totalFee,
    platformFee: round2(totalFee - domFee),
    financialSnapshot: financialQuote.financialSnapshot as
      | Prisma.InputJsonValue
      | undefined,
  };
}

/** Loads the current policy and quotes the offer (convenience over the two functions above). */
export async function priceOfferCycle(
  prisma: Parameters<typeof loadChargePolicy>[0],
  offer: Pick<Offer, 'platformTag' | 'ownerUserId' | 'amountCents'>,
  method: PaymentMethod,
  installments = 1,
  at?: Date,
): Promise<CycleQuote> {
  return quoteOfferCycle(
    await loadCyclePolicyContext(prisma, offer, at),
    offer,
    method,
    installments,
  );
}

/** JSON stored in Charge.snapshot at claim time; the quote it carries is frozen for the charge. */
export function frozenQuoteSnapshot(quote: CycleQuote, now: Date) {
  return {
    method: quote.method,
    installments: quote.installments,
    policyTag: quote.policyTag,
    baseAmountCents: quote.baseAmountCents,
    totalAmount: quote.totalAmount,
    netAmount: quote.netAmount,
    totalFee: quote.totalFee,
    domFee: quote.domFee,
    platformFee: quote.platformFee,
    financial: quote.financialSnapshot ?? null,
    frozenAt: now.toISOString(),
  } as Prisma.InputJsonValue;
}

/**
 * Reads a frozen quote back from Charge.snapshot; null for legacy rows that never froze one.
 * The first subscription charge snapshot has no totalAmount/method keys: they come from the
 * Charge columns.
 */
export function frozenQuoteFrom(
  charge: Pick<Charge, 'snapshot' | 'amountCents' | 'method'>,
): CycleQuote | null {
  const s = charge.snapshot as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return null;
  const num = (key: string) =>
    typeof s[key] === 'number' ? (s[key] as number) : null;
  const netAmount = num('netAmount');
  const method = (s.method as PaymentMethod | undefined) ?? charge.method;
  if (netAmount === null || !method) return null;
  const totalAmount = num('totalAmount') ?? charge.amountCents / 100;
  const totalFee = num('totalFee') ?? round2(totalAmount - netAmount);
  const domFee = num('domFee') ?? 0;
  return {
    platformTag: '',
    policyTag: String(s.policyTag ?? ''),
    method,
    installments: num('installments') ?? 1,
    baseAmountCents: num('baseAmountCents') ?? charge.amountCents,
    totalAmount,
    netAmount,
    domFee,
    totalFee,
    platformFee: num('platformFee') ?? round2(totalFee - domFee),
    financialSnapshot: (s.financial ?? undefined) as
      | Prisma.InputJsonValue
      | undefined,
  };
}
