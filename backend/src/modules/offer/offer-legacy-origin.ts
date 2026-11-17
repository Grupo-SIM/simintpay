import { Prisma } from '@prisma/client';

/**
 * Origin of an offer migrated from one of the former products (plan 0023). The columns
 * `Offer.legacyType`/`legacyId` were folded into `Offer.metadata` by the migration that dropped
 * the legacy tables. Both keys are reserved: API writers cannot set or change them.
 */
export type LegacyOfferType =
  'PaymentLink' | 'SubscriptionLink' | 'Plan' | 'PixCreditPlan' | 'Boleto';

type Metadata = Record<string, unknown> | null | undefined;

export function legacyOriginOf(
  metadata: unknown,
): { type: LegacyOfferType; id: string | null } | null {
  const m = metadata as Metadata;
  const type = m?.legacyType;
  if (typeof type !== 'string') return null;
  return {
    type: type as LegacyOfferType,
    id: typeof m?.legacyId === 'string' ? m.legacyId : null,
  };
}

/** Prisma filter of the offers migrated from `type`. */
export function legacyOriginWhere(
  type: LegacyOfferType,
): Prisma.OfferWhereInput {
  return { metadata: { path: ['legacyType'], equals: type } };
}

/** Prisma filter of the offers with no recorded legacy origin (native offers). */
export function noLegacyOriginWhere(): Prisma.OfferWhereInput {
  return {
    OR: [
      { metadata: { equals: Prisma.DbNull } },
      { metadata: { path: ['legacyType'], equals: Prisma.AnyNull } },
    ],
  };
}

/** Drops the reserved origin keys from client-supplied metadata. */
export function withoutLegacyOrigin(metadata: Metadata) {
  if (!metadata) return metadata;
  const { legacyType: _type, legacyId: _id, ...rest } = metadata;
  return rest;
}

/** The reserved origin keys of stored metadata, to carry over an update. */
export function pickLegacyOrigin(metadata: Metadata): Record<string, unknown> {
  const m = metadata ?? {};
  return {
    ...(m.legacyType !== undefined ? { legacyType: m.legacyType } : {}),
    ...(m.legacyId !== undefined ? { legacyId: m.legacyId } : {}),
  };
}
