import type { Prisma } from '@prisma/client';
import { affiliateAmount, snapshotFrom } from '../coproduction/coproduction';

/**
 * Affiliate block of the sales API events: public code, commission of this very sale and the
 * display name. Never an e-mail, an id or anyone else's amounts. Absent without commission.
 */
export function saleAffiliateEvent(sale: {
  financialSnapshot: Prisma.JsonValue | null;
  netAmount: Prisma.Decimal | null;
}): { code: string; commissionCents: number; name?: string } | undefined {
  if (sale.netAmount === null) return undefined;
  try {
    const snapshot = snapshotFrom(sale.financialSnapshot);
    const affiliate = snapshot?.affiliate;
    if (!snapshot || !affiliate) return undefined;
    const cents = affiliateAmount(snapshot, sale.netAmount).mul(100).toNumber();
    return {
      code: affiliate.code,
      commissionCents: cents,
      ...(affiliate.name ? { name: affiliate.name } : {}),
    };
  } catch {
    return undefined;
  }
}
