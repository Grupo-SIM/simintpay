/**
 * Redirecionamento das URLs legadas do checkout para o checkout unificado de oferta (`?oferta=`).
 *
 * Os parâmetros dos produtos legados (`simLinkCode`, `subscriptionLinkCode`, `simBoletoCode`,
 * `simPlanCode`, `linkCode`, `subscriptionCode`) e `?ofertaCode=` viram sempre `?oferta=`, com o
 * mesmo valor: `GET /ofertas/public/:code` resolve por código e, na falta, por id. É uma
 * retrocompatibilidade permanente, sem flag. `?code=PX-…` (plano PIX) não é redirecionado.
 */
export const LEGACY_PRODUCT_PARAMS = [
  'simPlanCode',
  'simLinkCode',
  'simBoletoCode',
  'subscriptionLinkCode',
  'linkCode',
  'subscriptionCode',
] as const;

const NEW_OFFER_PARAM = 'ofertaCode';

/** Devolve a URL de destino, ou `null` quando nada deve ser reescrito. */
export function offerRedirectTarget(url: URL): URL | null {
  const params = url.searchParams;
  if (params.get('oferta')) return null;

  const candidates: string[] = [...LEGACY_PRODUCT_PARAMS, NEW_OFFER_PARAM];
  const found = candidates.find((param) => params.get(param));
  if (!found) return null;

  const target = new URL(url);
  target.searchParams.set('oferta', params.get(found) as string);
  for (const param of candidates) target.searchParams.delete(param);
  return target;
}
