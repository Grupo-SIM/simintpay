import type { Prisma } from '@prisma/client';
import { loadChargePolicy, quoteFinancialCharge } from './financial-charge';
import { resolveTargetFee } from './target-fee';
import type { Method } from './financial-policy';

/** Reference purchase used to express every lane as a comparable rate (R$ 100,00). */
export const FEE_SCHEDULE_REFERENCE_CENTS = 10_000;

type Client = Pick<
  Prisma.TransactionClient,
  | 'financialPolicyRevision'
  | 'platform'
  | 'acquirerCatalogue'
  | 'acquirerFeeSchedule'
>;

export type FeeLane =
  | { available: false }
  | {
      available: true;
      /** Seller processing cost (acquirer + SimIntPay + additive fees) on the reference amount, in cents. */
      processingFeeCents: number;
      /** Same cost as a share of the reference amount, in millionths (150000 = 15%). Fixed fees are folded in. */
      processingRatePpm: number;
      interestCostCents: number;
      buyerInterestRatePpm: number;
      buyerInterestCents: number;
      buyerTotalCents: number;
      installmentCents: number;
      /** What the seller keeps of the reference amount after processing and interest, in cents. */
      netCents: number;
    };

/**
 * Online fee schedule actually charged to a platform's sellers: the same quote the checkout uses
 * (`loadChargePolicy` + `quoteFinancialCharge`), so the platform target fee ("taxa alvo") replaces the
 * manual SimIntPay fee exactly as in /admin/taxas. Never derived from the LIQUIDEZ default.
 */
export async function platformFeeSchedule(
  prisma: Client,
  tag: string,
  referenceCents = FEE_SCHEDULE_REFERENCE_CENTS,
) {
  const context = await loadChargePolicy(prisma, tag);
  const reference = referenceCents / 100;
  const lane = (method: Method, installments: number): FeeLane => {
    let quote: ReturnType<typeof quoteFinancialCharge> = null;
    try {
      quote = quoteFinancialCharge(context, reference, method, installments);
    } catch {
      return { available: false };
    }
    if (!quote) return { available: false };
    const snapshot = quote.financialSnapshot;
    return {
      available: true,
      processingFeeCents: snapshot.processingCostCents,
      processingRatePpm: Math.round(
        (snapshot.processingCostCents * 1_000_000) / referenceCents,
      ),
      interestCostCents: snapshot.interestCostCents,
      buyerInterestRatePpm: snapshot.buyerInterestRatePpm,
      buyerInterestCents: snapshot.buyerInterestCents,
      buyerTotalCents: snapshot.buyerTotalCents,
      installmentCents: snapshot.installmentCents,
      netCents: snapshot.netCents,
    };
  };
  return {
    referenceAmountCents: referenceCents,
    platformFeeMode: context.platformFeeMode ?? null,
    globalTargetFeePpm: context.policy.document.targetFeePpm ?? null,
    platformTargetFeePpm: context.targetFeePpm ?? null,
    /** Target actually applied (platform override wins; 0 turns it off; null means manual fees). */
    effectiveTargetFeePpm: resolveTargetFee(
      context.policy.document.targetFeePpm,
      context.targetFeePpm,
    ),
    pix: lane('PIX', 1),
    debit: lane('DEBIT_CARD', 1),
    boleto: lane('BOLETO', 1),
    credit: Array.from({ length: 12 }, (_, i) => ({
      installments: i + 1,
      ...lane('CREDIT_CARD', i + 1),
    })),
  };
}

/**
 * Seller settlement of a purchase the buyer actually paid `paidCents` for (interest included), priced by the
 * same quote as `platformFeeSchedule`/checkout. The quote takes the pre-interest amount, so the paid total is
 * inverted over the monotonic cent function (as `quoteReportedPos` does). Returns null when the lane is
 * unavailable and throws when no pre-interest amount reproduces the paid total exactly.
 */
export async function quotePaidAmount(
  prisma: Client,
  tag: string,
  paidCents: number,
  method: Method,
  installments: number,
) {
  const context = await loadChargePolicy(prisma, tag);
  let low = 1,
    high = paidCents;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const quote = quoteFinancialCharge(
      context,
      middle / 100,
      method,
      installments,
    );
    if (!quote) return null;
    const total = Math.round(quote.totalAmount * 100);
    if (total === paidCents) return quote;
    if (total < paidCents) low = middle + 1;
    else high = middle - 1;
  }
  throw new Error('Valor pago não corresponde à política de juros');
}

/**
 * Seller share of a card purchase the buyer paid in `installments`. `baseCents` is the owner amount BEFORE interest
 * (what the pending PIX 1x entry recorded: order total minus affiliate commission); the buyer interest of the lane is
 * applied to that base only, exactly as the checkout quotes a card charge (`quoteFinancialCharge` on the
 * pre-interest price). Interest on the affiliate commission share is not part of the commission base and stays
 * with the fee schedule/acquirer cost model. Returns null when the lane is unavailable.
 */
export async function quoteCardOwnerShare(
  prisma: Client,
  tag: string,
  baseCents: number,
  installments: number,
) {
  const context = await loadChargePolicy(prisma, tag);
  return quoteFinancialCharge(
    context,
    baseCents / 100,
    'CREDIT_CARD',
    installments,
  );
}
