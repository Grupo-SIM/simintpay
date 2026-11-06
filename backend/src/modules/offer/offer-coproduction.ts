import type { Product } from '../coproduction/coproduction';

const LEGACY_PRODUCT: Record<string, Product> = {
  PaymentLink: 'links-pagamento',
  SubscriptionLink: 'links-assinatura',
  Boleto: 'boletos',
  Plan: 'planos',
  PixCreditPlan: 'planos-pix',
};

/**
 * Onde o acordo de coprodução de uma oferta está registrado. Uma oferta nativa guarda o acordo
 * em `ofertas`; uma migrada de um produto legado continua lendo o acordo já cadastrado nele,
 * para que a divisão existente não se perca na migração.
 */
export function coproductionKeyFor(offer: {
  id: string;
  legacyType?: string | null;
  legacyId?: string | null;
}): { product: Product; productId: string } {
  const legacy = offer.legacyType
    ? LEGACY_PRODUCT[offer.legacyType]
    : undefined;
  return legacy && offer.legacyId
    ? { product: legacy, productId: offer.legacyId }
    : { product: 'ofertas', productId: offer.id };
}
