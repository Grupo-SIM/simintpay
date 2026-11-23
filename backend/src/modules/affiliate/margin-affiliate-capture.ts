import type { Prisma } from '@prisma/client';
import {
  canonicalProduct,
  type ProductKey,
  type Snapshot,
} from '../coproduction/coproduction';
import { paymentTracking } from '../platform-core/payment-tracking';
import { effectivePercentage, effectiveRenewals } from './affiliate';
import { platformIdOfOffer } from './affiliate-platform';
import type {
  MarginAffiliateConfig,
  MarginAffiliateSnapshot,
} from './margin-affiliate';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

type StoredConfig = {
  version: number;
  defaultPercentageBps: number | null;
  commissionOnRenewals: boolean | null;
  affiliates: { userId: string; percentageBps: number | null }[];
};

/** Saved margin configuration of one scope; null when nothing was ever saved. */
export async function readMarginConfig(
  db: Db,
  product: 'plataformas' | 'ofertas',
  productId: string,
): Promise<MarginAffiliateConfig | null> {
  const rows = await db.$queryRaw<
    StoredConfig[]
  >`SELECT version, "defaultPercentageBps", "commissionOnRenewals", affiliates FROM "MarginAffiliateAgreement" WHERE product = ${product} AND "productId" = ${productId}`;
  return rows[0] ? { ...rows[0], linkBaseUrl: null } : null;
}

function attachMargin(
  snapshot: Snapshot | null,
  marginAffiliate: MarginAffiliateSnapshot,
  product: Snapshot['product'],
  productId: string,
  ownerUserId: string,
): Snapshot {
  const base: Snapshot = snapshot ?? {
    basis: 'NET',
    version: 0,
    product,
    productId,
    ownerUserId,
    participants: [],
  };
  return { ...base, marginAffiliate };
}

/**
 * Resolves the SimIntPay-margin affiliate of a sale from the same `aff` code. Independent of the
 * regular affiliate: the same person may hold both, and neither limit nor deduplication applies,
 * because this commission never touches the owner's net. Unknown codes, the owner and the buyer
 * himself yield no commission and no error.
 */
export async function captureMarginAffiliate(
  db: Db,
  snapshot: Snapshot | null,
  ctx: {
    product: ProductKey;
    productId: string;
    ownerUserId: string;
    platformTag?: string;
    tracking?: unknown;
    buyerEmail?: string | null;
  },
): Promise<Snapshot | null> {
  const code = paymentTracking(ctx.tracking).aff;
  if (!code) return snapshot;
  const product = canonicalProduct(ctx.product);
  const platformId =
    product === 'plataformas'
      ? ctx.productId
      : await platformIdOfOffer(db, ctx.productId, ctx.platformTag);
  if (!platformId) return snapshot;
  const users = await db.$queryRaw<
    { userId: string; name: string; email: string }[]
  >`SELECT c."userId", u.name, u.email FROM "AffiliateCode" c JOIN "User" u ON u.id = c."userId" WHERE c."platformId" = ${platformId} AND c.code = ${code} AND u."isActive" = true AND u."isPurged" = false AND u."clientStatus" = 'APPROVED'`;
  const user = users[0];
  if (!user || user.userId === ctx.ownerUserId) return snapshot;
  if (
    ctx.buyerEmail &&
    ctx.buyerEmail.trim().toLowerCase() === user.email.trim().toLowerCase()
  )
    return snapshot;
  const platform = await readMarginConfig(db, 'plataformas', platformId);
  const offer =
    product === 'ofertas'
      ? await readMarginConfig(db, 'ofertas', ctx.productId)
      : null;
  const effective = effectivePercentage(user.userId, offer, platform);
  if (!effective) return snapshot;
  return attachMargin(
    snapshot,
    {
      userId: user.userId,
      code,
      name: user.name,
      platformId,
      percentageBps: effective.percentageBps,
      level: effective.level,
      versions: {
        ...(platform ? { platform: platform.version } : {}),
        ...(offer ? { offer: offer.version } : {}),
      },
      commissionOnRenewals: effectiveRenewals(offer, platform),
    },
    product,
    ctx.productId,
    ctx.ownerUserId,
  );
}

/** Margin affiliate frozen on a subscription contract by its first sale. */
export function contractMarginAffiliate(
  metadata: Prisma.JsonValue | null | undefined,
): MarginAffiliateSnapshot | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return null;
  const a = (metadata as Record<string, unknown>).marginAffiliate as
    MarginAffiliateSnapshot | undefined;
  return a && typeof a.userId === 'string' && Number.isInteger(a.percentageBps)
    ? a
    : null;
}

/**
 * Renewals keep the first sale's margin affiliate. With `commissionOnRenewals` off only the first
 * paid cycle pays.
 */
export function renewalMarginAffiliate(
  snapshot: Snapshot | null,
  stored: MarginAffiliateSnapshot | null,
  renewal: boolean,
  product: ProductKey,
  productId: string,
  ownerUserId: string,
): Snapshot | null {
  if (!stored || (renewal && !stored.commissionOnRenewals)) return snapshot;
  return attachMargin(
    snapshot,
    { ...stored, isRenewal: renewal },
    canonicalProduct(product),
    productId,
    ownerUserId,
  );
}
