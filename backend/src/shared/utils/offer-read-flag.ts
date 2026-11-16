/**
 * Plan 0023, phase 3: readers resolve the product through `Offer` (Offer.id = legacy product id)
 * instead of the legacy tables. Off by default; the legacy read stays the default until parity closes.
 */
export function offersReadEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return ['1', 'true'].includes(
    String(env.OFFERS_READ_ENABLED ?? '').toLowerCase(),
  );
}
