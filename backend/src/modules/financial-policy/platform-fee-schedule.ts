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
