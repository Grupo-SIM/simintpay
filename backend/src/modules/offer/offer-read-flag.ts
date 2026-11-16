/**
 * Phase 3 of plan 0023: readers that still query the legacy product tables (`PaymentLink`,
 * `SubscriptionLink`, `Plan`, `PixCreditPlan`, `Boleto`) can resolve the same product through
 * `Offer` instead (`Offer.id` is the legacy id). The flag is off by default; turn it on only
 * after the products were copied (phase 2). It switches reads and the non-financial ownership
 * operations of platforms, coproduction and admin; money is still written by a single path.
 */
export const OFFER_PLATFORM_READS_ENV = 'OFFER_PLATFORM_READS';

export function offerPlatformReadsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[OFFER_PLATFORM_READS_ENV] === '1';
}
