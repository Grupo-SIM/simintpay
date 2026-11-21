import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ProductKey, Snapshot } from '../coproduction/coproduction';
import { worstCaseBps } from './affiliate';
import { platformIdOfOffer, readAffiliateConfig } from './affiliate-capture';

type Tx = Pick<Prisma.TransactionClient, '$queryRaw'>;
/** Same signature as `captureCoproduction`; injected so this module does not import its service. */
type Capture = (
  tx: Tx,
  product: ProductKey,
  productId: string,
  ownerUserId: string,
  platformTag?: string,
) => Promise<Snapshot | null>;

const percent = (bps: number) =>
  `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/** Message shared by both PUTs; states the total and the excess, never a third party's data. */
export function jointLimitMessage(worst: number): string {
  return `A soma de coprodutores e afiliados chegaria a ${percent(worst)} do líquido, ${percent(worst - 10000)} acima do limite de 100%. Reduza as participações ou as comissões.`;
}

/**
 * Joint limit of coproducers plus affiliates, over the net, for the sales a scope can produce.
 * Reads the saved state of both modules, so it runs after the caller wrote its own change inside
 * the same transaction (the exception rolls it back). The offer scope checks that offer; the
 * platform scope checks the platform itself and every offer of it that carries its own agreement.
 * Callers hold the platform's `affiliate:<platformId>` advisory lock, which serializes both PUTs.
 */
export async function assertJointLimit(
  tx: Tx,
  capture: Capture,
  scope: {
    product: 'plataformas' | 'ofertas';
    id: string;
    ownerId: string;
    platformId: string;
    platformTag: string | null;
  },
  /** Coproduction PUTs ignore offers whose own agreement is unaffected by the change. */
  inheritingOnly = false,
): Promise<void> {
  const fail = (worst: number) => {
    throw new BadRequestException(jointLimitMessage(worst));
  };
  const tag = scope.platformTag ?? undefined;
  const platform = await readAffiliateConfig(
    tx,
    'plataformas',
    scope.product === 'plataformas' ? scope.id : scope.platformId,
  );
  if (scope.product === 'ofertas') {
    const worst = worstCaseBps(
      await readAffiliateConfig(tx, 'ofertas', scope.id),
      platform,
      await capture(tx, 'ofertas', scope.id, scope.ownerId, tag),
    );
    if (worst > 10000) fail(worst);
    return;
  }
  const own = worstCaseBps(
    null,
    platform,
    await capture(tx, 'plataformas', scope.id, scope.ownerId),
  );
  if (own > 10000) fail(own);
  const offers = await tx.$queryRaw<{ id: string; ownerUserId: string }[]>`
    SELECT o.id, o."ownerUserId" FROM "Offer" o
    WHERE o."platformTag" = ${scope.platformTag}
      AND (EXISTS (SELECT 1 FROM "AffiliateAgreement" a WHERE a.product = 'ofertas' AND a."productId" = o.id)
        OR EXISTS (SELECT 1 FROM "CoproductionAgreement" c WHERE c.product = 'ofertas' AND c."productId" = o.id))`;
  for (const offer of offers) {
    const snapshot = await capture(
      tx,
      'ofertas',
      offer.id,
      offer.ownerUserId,
      tag,
    );
    if (inheritingOnly && snapshot && !snapshot.source) continue;
    const worst = worstCaseBps(
      await readAffiliateConfig(tx, 'ofertas', offer.id),
      platform,
      snapshot,
    );
    if (worst > 10000) fail(worst);
  }
}

/**
 * Coproduction PUT side of the joint limit: resolves the platform of the saved product (offers
 * outside any platform have no affiliates) and takes the same lock as the affiliate PUT, so two
 * concurrent saves cannot each pass on the other's old state.
 */
export async function assertJointLimitForCoproduction(
  tx: Tx,
  capture: Capture,
  product: 'plataformas' | 'ofertas',
  id: string,
  ownerId: string,
): Promise<void> {
  let platformId: string | null;
  let platformTag: string | null;
  if (product === 'plataformas') {
    platformId = id;
    platformTag =
      (
        await tx.$queryRaw<
          { tag: string }[]
        >`SELECT tag FROM "Platform" WHERE id = ${id}`
      )[0]?.tag ?? null;
  } else {
    platformId = await platformIdOfOffer(tx, id);
    platformTag = platformId
      ? ((
          await tx.$queryRaw<
            { tag: string }[]
          >`SELECT tag FROM "Platform" WHERE id = ${platformId}`
        )[0]?.tag ?? null)
      : null;
  }
  if (!platformId) return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`affiliate:${platformId}`}, 0))::text`;
  await assertJointLimit(
    tx,
    capture,
    { product, id, ownerId, platformId, platformTag },
    true,
  );
}
