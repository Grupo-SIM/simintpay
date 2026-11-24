import type { Prisma } from '@prisma/client';
import {
  canonicalProduct,
  type ProductKey,
  type Snapshot,
} from '../coproduction/coproduction';
import { paymentTracking } from '../platform-core/payment-tracking';
import { effectivePercentage, effectiveRenewals } from './affiliate';
import { platformIdOfOffer } from './affiliate-platform';
import {
  effectiveCoproducers,
  type MarginAffiliateConfig,
  type MarginAffiliateSnapshot,
  type MarginCoproducer,
} from './margin-affiliate';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

type StoredConfig = {
  version: number;
  defaultPercentageBps: number | null;
  commissionOnRenewals: boolean | null;
  affiliates: { userId: string; percentageBps: number | null }[];
  coproducers: MarginCoproducer[];
};

/** Saved margin configuration of one scope; null when nothing was ever saved. */
export async function readMarginConfig(
  db: Db,
  product: 'plataformas' | 'ofertas',
  productId: string,
): Promise<MarginAffiliateConfig | null> {
  const rows = await db.$queryRaw<
    StoredConfig[]
  >`SELECT version, "defaultPercentageBps", "commissionOnRenewals", affiliates, coproducers FROM "MarginAffiliateAgreement" WHERE product = ${product} AND "productId" = ${productId}`;
  return rows[0] ? { ...rows[0], linkBaseUrl: null } : null;
}

type Scope = {
  product: ReturnType<typeof canonicalProduct>;
  productId: string;
  ownerUserId: string;
};

/** Coproducers of the sale's scope that can still receive: active approved accounts, never the owner. */
async function marginCoproducers(
  db: Db,
  scope: Scope,
  platformId: string,
): Promise<MarginCoproducer[]> {
  const platform = await readMarginConfig(db, 'plataformas', platformId);
  const offer =
    scope.product === 'ofertas'
      ? await readMarginConfig(db, 'ofertas', scope.productId)
      : null;
  const listed = effectiveCoproducers(offer, platform).filter(
    (c) => c.userId !== scope.ownerUserId,
  );
  if (!listed.length) return [];
  const ids = listed.map((c) => c.userId);
  const active = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "User" WHERE id = ANY(${ids}::text[]) AND "isActive" = true AND "isPurged" = false AND "clientStatus" = 'APPROVED'`;
  const allowed = new Set(active.map((u) => u.id));
  return listed.filter((c) => allowed.has(c.userId));
}

function attachMargin(
  snapshot: Snapshot | null,
  margin: {
    marginParticipants: MarginCoproducer[];
    marginAffiliate?: MarginAffiliateSnapshot;
  },
  scope: Scope,
): Snapshot | null {
  if (!margin.marginParticipants.length && !margin.marginAffiliate)
    return snapshot;
  const base: Snapshot = snapshot ?? {
    basis: 'NET',
    version: 0,
    product: scope.product,
    productId: scope.productId,
    ownerUserId: scope.ownerUserId,
    participants: [],
  };
  return {
    ...base,
    ...(margin.marginParticipants.length
      ? { marginParticipants: margin.marginParticipants }
      : {}),
    ...(margin.marginAffiliate
      ? { marginAffiliate: margin.marginAffiliate }
      : {}),
  };
}

/** One person never holds two margin shares of a sale: the coproducer wins over the affiliate. */
function affiliateAllowed(
  affiliate: MarginAffiliateSnapshot,
  coproducers: MarginCoproducer[],
): boolean {
  if (coproducers.some((c) => c.userId === affiliate.userId)) return false;
  const total = coproducers.reduce((sum, c) => sum + c.percentageBps, 0);
  return total + affiliate.percentageBps <= 10000;
}

/**
 * Resolves the SimIntPay-margin shares of a sale: the fixed coproducers of the scope (no code
 * needed) and, from the `aff` code, the margin affiliate. Independent of the net-based shares: the
 * same person may hold both, and neither deduplication nor the 100%-of-net limit applies, because
 * these shares never touch the owner's net. Unknown codes, the owner and the buyer himself yield
 * no affiliate commission and no error.
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
  const product = canonicalProduct(ctx.product);
  const scope: Scope = {
    product,
    productId: ctx.productId,
    ownerUserId: ctx.ownerUserId,
  };
  const platformId =
    product === 'plataformas'
      ? ctx.productId
      : await platformIdOfOffer(db, ctx.productId, ctx.platformTag);
  if (!platformId) return snapshot;
  const marginParticipants = await marginCoproducers(db, scope, platformId);
  let marginAffiliate: MarginAffiliateSnapshot | undefined;
  const code = paymentTracking(ctx.tracking).aff;
  if (code) {
    const users = await db.$queryRaw<
      { userId: string; name: string; email: string }[]
    >`SELECT c."userId", u.name, u.email FROM "AffiliateCode" c JOIN "User" u ON u.id = c."userId" WHERE c."platformId" = ${platformId} AND c.code = ${code} AND u."isActive" = true AND u."isPurged" = false AND u."clientStatus" = 'APPROVED'`;
    const user = users[0];
    const self =
      !!ctx.buyerEmail &&
      !!user &&
      ctx.buyerEmail.trim().toLowerCase() === user.email.trim().toLowerCase();
    if (user && user.userId !== ctx.ownerUserId && !self) {
      const platform = await readMarginConfig(db, 'plataformas', platformId);
      const offer =
        product === 'ofertas'
          ? await readMarginConfig(db, 'ofertas', ctx.productId)
          : null;
      const effective = effectivePercentage(user.userId, offer, platform);
      if (effective) {
        const candidate: MarginAffiliateSnapshot = {
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
        };
        if (affiliateAllowed(candidate, marginParticipants))
          marginAffiliate = candidate;
      }
    }
  }
  return attachMargin(snapshot, { marginParticipants, marginAffiliate }, scope);
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
 * Margin shares of a renewal: coproducers are read live (like the net coproduction); the affiliate
 * is the first sale's, and with `commissionOnRenewals` off only the first paid cycle pays. A
 * renewal whose sum would overflow is billed without the affiliate rather than blocking it.
 */
export async function renewalMarginAffiliate(
  db: Db,
  snapshot: Snapshot | null,
  stored: MarginAffiliateSnapshot | null,
  renewal: boolean,
  product: ProductKey,
  productId: string,
  ownerUserId: string,
  platformTag?: string,
): Promise<Snapshot | null> {
  const scope: Scope = {
    product: canonicalProduct(product),
    productId,
    ownerUserId,
  };
  const platformId =
    scope.product === 'plataformas'
      ? productId
      : await platformIdOfOffer(db, productId, platformTag);
  const marginParticipants = platformId
    ? await marginCoproducers(db, scope, platformId)
    : [];
  const affiliate =
    stored &&
    !(renewal && !stored.commissionOnRenewals) &&
    affiliateAllowed(stored, marginParticipants)
      ? { ...stored, isRenewal: renewal }
      : undefined;
  return attachMargin(
    snapshot,
    { marginParticipants, marginAffiliate: affiliate },
    scope,
  );
}
