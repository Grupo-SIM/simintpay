import type { Prisma } from '@prisma/client';

/**
 * Plan 0023, phase 3: the admin client audit lists and backfills legacy products. With
 * `OFFER_PLATFORM_READS=1` the same groups are selected through `Offer` (the id is the legacy id,
 * `legacyType` says where a migrated offer came from, native offers fall in the recurring or
 * one-off group by `renewalMode`).
 */
export type OfferGroup =
  | 'plan'
  | 'pixPlan'
  | 'paymentLink'
  | 'subscriptionLink';

export function offerGroupWhere(group: OfferGroup): Prisma.OfferWhereInput {
  switch (group) {
    case 'plan':
      return { legacyType: 'Plan' };
    case 'pixPlan':
      return { legacyType: 'PixCreditPlan' };
    case 'paymentLink':
      return {
        renewalMode: 'NONE',
        OR: [{ legacyType: null }, { legacyType: 'PaymentLink' }],
      };
    case 'subscriptionLink':
      return {
        renewalMode: { not: 'NONE' },
        OR: [{ legacyType: null }, { legacyType: 'SubscriptionLink' }],
      };
  }
}

/** Row of an offer in the audit listing, in the shape the legacy tables returned. */
export function offerAuditRow(
  offer: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    amountCents: number;
    isActive: boolean;
    platformTag: string | null;
    createdAt: Date;
    ownerUserId: string;
    owner: { id: string; name: string; email: string };
  },
  group: OfferGroup,
) {
  const { owner, amountCents, ownerUserId, platformTag, name, ...rest } = offer;
  return {
    ...rest,
    userId: ownerUserId,
    user: owner,
    plataformas: platformTag ? [platformTag] : [],
    // Legacy field names of each group: links use `title`, plans `name`/`price`, links `amount`.
    ...(group === 'paymentLink' ? { title: name } : { name }),
    ...(group === 'pixPlan' ? { price: amountCents / 100 } : {}),
    ...(group === 'plan' ? { price: amountCents / 100 } : {}),
    ...(group === 'paymentLink' || group === 'subscriptionLink'
      ? { amount: amountCents / 100 }
      : {}),
  };
}
