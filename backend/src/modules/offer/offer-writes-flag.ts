import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

/**
 * Phase 4 of plan 0023 (cut the writers): with `OFFER_WRITES_ONLY=1` the legacy public checkouts,
 * REST CRUD and platform routes write only to `Offer`. Off by default; the legacy path is
 * untouched while it is off. Readers go through `Offer` unconditionally. There is no financial dual-write: one path writes money, and with the flag on
 * it is the offer one.
 */
export const OFFER_WRITES_ONLY_ENV = 'OFFER_WRITES_ONLY';

export function offerWritesOnlyEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return ['1', 'true'].includes((env[OFFER_WRITES_ONLY_ENV] ?? '').trim());
}

/**
 * Use counter of a product sold through a legacy writer that is still reachable. With the flag
 * on the counter lives in `Offer.usedCount` (the offer shares the legacy id) and the legacy
 * `currentUses` column is left alone; otherwise `legacy` runs as before.
 */
export async function recordProductUse(
  prisma: Pick<PrismaService, 'offer'>,
  id: string,
  legacy: () => Promise<unknown>,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!offerWritesOnlyEnabled(env)) {
    await legacy();
    return;
  }
  await prisma.offer.updateMany({
    where: { id },
    data: { usedCount: { increment: 1 } },
  });
}

/** Product reference stored on a platform `Transaction`: `offerId` with the flag, else `paymentLinkId`. */
export function transactionProductRef(
  linkId: string | undefined,
  env: Record<string, string | undefined> = process.env,
): { offerId: string } | { paymentLinkId: string } | Record<string, never> {
  if (!linkId) return {};
  return offerWritesOnlyEnabled(env)
    ? { offerId: linkId }
    : { paymentLinkId: linkId };
}
