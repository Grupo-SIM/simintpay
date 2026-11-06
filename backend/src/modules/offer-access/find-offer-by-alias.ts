import type { Offer, PrismaClient } from '@prisma/client';

type OfferLookup = {
  offerCodeAlias: Pick<PrismaClient['offerCodeAlias'], 'findFirst'>;
};

/**
 * Resolve uma oferta por um código alternativo (`OfferCodeAlias`, ex.: `PX-ABC123` do antigo
 * link-code do plano PIX). Só considera alias ativo; não filtra por `Offer.isActive`, para o
 * chamador decidir (o checkout público já valida a disponibilidade).
 *
 * O helper genérico `findOfferByCodeOrId` (modules/offer) deve chamar esta função como último
 * passo: `code` -> `id` -> `findOfferByAlias`.
 */
export async function findOfferByAlias(
  prisma: OfferLookup,
  code: string,
): Promise<Offer | null> {
  const alias = await prisma.offerCodeAlias.findFirst({
    where: { code: code.trim(), isActive: true },
    include: { offer: true },
  });
  return (alias as { offer: Offer } | null)?.offer ?? null;
}

/** Gera o alias no mesmo formato do `PixPlanLinkCode` legado: `PX-` + 6 caracteres base36. */
export function generatePixAliasCode(): string {
  return `PX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}
