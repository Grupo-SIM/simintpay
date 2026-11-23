import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Snapshot } from '../coproduction/coproduction';
import {
  canonicalProduct,
  type ProductKey,
} from '../coproduction/coproduction';
import { paymentTracking } from '../platform-core/payment-tracking';
import {
  dedupOverlap,
  effectivePercentage,
  effectiveRenewals,
  type AffiliateConfig,
  type AffiliateSnapshot,
} from './affiliate';

import { platformIdOfOffer } from './affiliate-platform';
import { captureMarginAffiliate } from './margin-affiliate-capture';

export { platformIdOfOffer };
type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

type StoredConfig = {
  version: number;
  defaultPercentageBps: number | null;
  commissionOnRenewals: boolean | null;
  linkBaseUrl: string | null;
  affiliates: { userId: string; percentageBps: number | null }[];
};

/** Saved configuration of one scope; null when nothing was ever saved. */
export async function readAffiliateConfig(
  db: Db,
  product: 'plataformas' | 'ofertas',
  productId: string,
): Promise<AffiliateConfig | null> {
  const rows = await db.$queryRaw<
    StoredConfig[]
  >`SELECT version, "defaultPercentageBps", "commissionOnRenewals", "linkBaseUrl", affiliates FROM "AffiliateAgreement" WHERE product = ${product} AND "productId" = ${productId}`;
  return rows[0] ?? null;
}

function participantsTotal(snapshot: Snapshot | null): number {
  return (snapshot?.participants ?? []).reduce(
    (sum, p) => sum + p.percentageBps,
    0,
  );
}

/**
 * Adds the affiliate to the sale snapshot, creating an owner-only one when there is no
 * coproduction. The same person is deduplicated against the coproducers first, and the sum
 * limit applies to the deduplicated list.
 */
function attach(
  original: Snapshot | null,
  stored: AffiliateSnapshot,
  product: Snapshot['product'],
  productId: string,
  ownerUserId: string,
  onOverflow: 'throw' | 'drop',
  /** Renewals keep the first sale's outcome: the affiliate always replaces the coproducer. */
  renewal = false,
): Snapshot | null {
  let snapshot = original;
  let affiliate = stored;
  if (renewal) {
    if (snapshot?.participants.some((p) => p.userId === stored.userId))
      snapshot = {
        ...snapshot,
        participants: snapshot.participants.filter(
          (p) => p.userId !== stored.userId,
        ),
        ...(stored.deduplication
          ? { deduplication: stored.deduplication }
          : {}),
      };
  } else {
    const d = dedupOverlap(snapshot, stored);
    snapshot = d.snapshot;
    if (!d.keepAffiliate) return snapshot;
    if (d.deduplication)
      affiliate = { ...stored, deduplication: d.deduplication };
  }
  if (participantsTotal(snapshot) + affiliate.percentageBps > 10000) {
    if (onOverflow === 'drop') return original;
    throw new ConflictException(
      'Comissão do afiliado somada à co-produção ultrapassa 100% do líquido',
    );
  }
  const base: Snapshot = snapshot ?? {
    basis: 'NET',
    version: 0,
    product,
    productId,
    ownerUserId,
    participants: [],
  };
  return { ...base, affiliate };
}

export type CaptureContext = {
  product: ProductKey;
  productId: string;
  ownerUserId: string;
  platformTag?: string;
  /** Raw client tracking; only a valid `aff` (or `ref`) is read from it. */
  tracking?: unknown;
  buyerEmail?: string | null;
};

/**
 * Resolves the affiliate of a sale before contacting the gateway. Unknown or removed codes,
 * the owner and the buyer himself yield no commission and no error.
 */
export async function captureAffiliate(
  db: Db,
  snapshot: Snapshot | null,
  ctx: CaptureContext,
): Promise<Snapshot | null> {
  return captureMarginAffiliate(
    db,
    await captureNetAffiliate(db, snapshot, ctx),
    ctx,
  );
}

async function captureNetAffiliate(
  db: Db,
  snapshot: Snapshot | null,
  ctx: CaptureContext,
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
  const platform = await readAffiliateConfig(db, 'plataformas', platformId);
  const offer =
    product === 'ofertas'
      ? await readAffiliateConfig(db, 'ofertas', ctx.productId)
      : null;
  const effective = effectivePercentage(user.userId, offer, platform);
  if (!effective) return snapshot;
  return attach(
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
    'throw',
  );
}

/** Affiliate frozen on a subscription contract by its first sale. */
export function contractAffiliate(
  metadata: Prisma.JsonValue | null | undefined,
): AffiliateSnapshot | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return null;
  const a = (metadata as Record<string, unknown>).affiliate as
    AffiliateSnapshot | undefined;
  return a && typeof a.userId === 'string' && Number.isInteger(a.percentageBps)
    ? a
    : null;
}

/** True when another cycle of this contract was already paid, i.e. this charge is a renewal. */
export async function isRenewalCharge(
  db: Db,
  contractId: string | null | undefined,
  chargeId: string,
): Promise<boolean> {
  if (!contractId) return false;
  const rows = await db.$queryRaw<
    { count: number }[]
  >`SELECT count(*)::int AS count FROM "Charge" WHERE "contractId" = ${contractId} AND status = 'PAID' AND id <> ${chargeId}`;
  return rows[0].count > 0;
}

/**
 * Renewals keep the original snapshot. With `commissionOnRenewals` off only the first paid
 * cycle pays; later ones carry no affiliate. A renewal whose sum would overflow is billed
 * without commission rather than blocking the subscription.
 */
export function renewalAffiliate(
  snapshot: Snapshot | null,
  stored: AffiliateSnapshot | null,
  renewal: boolean,
  product: ProductKey,
  productId: string,
  ownerUserId: string,
): Snapshot | null {
  if (!stored || (renewal && !stored.commissionOnRenewals)) return snapshot;
  return attach(
    snapshot,
    { ...stored, isRenewal: renewal },
    canonicalProduct(product),
    productId,
    ownerUserId,
    'drop',
    true,
  );
}
