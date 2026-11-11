import type { Product } from '../coproduction/coproduction';

/**
 * Onde o acordo de coprodução de uma oferta está registrado. Sempre em `ofertas`, com o id da
 * oferta: o id de uma oferta migrada é o do produto legado, e o script de migração renomeia os
 * acordos antigos (`links-pagamento` etc.) para `ofertas` mantendo o `productId`.
 */
export function coproductionKeyFor(offer: { id: string }): {
  product: Product;
  productId: string;
} {
  return { product: 'ofertas', productId: offer.id };
}
