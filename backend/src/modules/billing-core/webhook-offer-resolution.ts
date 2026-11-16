import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

/**
 * Plan 0023, phase 3 (DOM webhooks): resolves what a gateway webhook refers to through
 * `ExternalRef` and `Offer.id` instead of the legacy `dom*` columns.
 *
 * Reading the legacy tables stays the default. `OFFER_WEBHOOK_RESOLUTION=true` turns the offer
 * resolution on; nothing here writes money, it only identifies the target and reports misses.
 */
export const DOM_ACQUIRER_CODE = 'DOM';
export const UNRESOLVED_WEBHOOK_TAG = 'OFFER_WEBHOOK_UNRESOLVED';

export function offerWebhookResolutionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return ['1', 'true', 'on'].includes(
    String(env.OFFER_WEBHOOK_RESOLUTION ?? '')
      .trim()
      .toLowerCase(),
  );
}

export type WebhookOfferResolution = {
  via: 'offer-id' | 'external-ref' | 'billing-contract';
  offerId: string | null;
  contractId?: string;
};

type Db = Pick<PrismaService, 'offer' | 'externalRef' | 'billingContract'>;

/** A legacy link id (kept as `Offer.id` by the migration) or a DOM payment link id. */
export async function resolveOfferByLinkReference(
  prisma: Db,
  reference: string | null | undefined,
): Promise<WebhookOfferResolution | null> {
  if (!reference) return null;
  const byId = await prisma.offer.findUnique({
    where: { id: reference },
    select: { id: true },
  });
  if (byId) return { via: 'offer-id', offerId: byId.id };
  const ref = await prisma.externalRef.findUnique({
    where: {
      acquirerCode_kind_externalId: {
        acquirerCode: DOM_ACQUIRER_CODE,
        kind: 'PAYMENT_LINK',
        externalId: reference,
      },
    },
  });
  if (ref?.entityType === 'Offer')
    return { via: 'external-ref', offerId: ref.entityId };
  return null;
}

/** A DOM subscription id (`domSubscriptionId`): ExternalRef first, then the contract's own column. */
export async function resolveOfferBySubscriptionReference(
  prisma: Db,
  subscriberId: string | null | undefined,
): Promise<WebhookOfferResolution | null> {
  if (!subscriberId) return null;
  const ref = await prisma.externalRef.findUnique({
    where: {
      acquirerCode_kind_externalId: {
        acquirerCode: DOM_ACQUIRER_CODE,
        kind: 'SUBSCRIPTION',
        externalId: subscriberId,
      },
    },
  });
  if (ref?.entityType === 'Offer')
    return { via: 'external-ref', offerId: ref.entityId };
  const contractId =
    ref?.entityType === 'BillingContract' ? ref.entityId : undefined;
  const contract = await prisma.billingContract.findFirst({
    where: contractId
      ? { id: contractId }
      : { externalSubscriptionId: subscriberId },
    select: { id: true, offerId: true },
  });
  return contract
    ? {
        via: contractId ? 'external-ref' : 'billing-contract',
        offerId: contract.offerId,
        contractId: contract.id,
      }
    : null;
}

const unresolved = new Map<string, number>();

/** Counter by handler, read by tests and by the log aggregator through the tagged line. */
export function unresolvedWebhookCounts(): Record<string, number> {
  return Object.fromEntries(unresolved);
}

/** A webhook that matched nothing is accepted and lost: make that visible. */
export function alertUnresolvedWebhook(
  logger: Pick<Logger, 'error'>,
  handler: string,
  reference: string | null | undefined,
): void {
  unresolved.set(handler, (unresolved.get(handler) ?? 0) + 1);
  logger.error(
    `[${UNRESOLVED_WEBHOOK_TAG}] handler=${handler} reference=${reference ?? 'null'} total=${unresolved.get(handler)}`,
  );
}
