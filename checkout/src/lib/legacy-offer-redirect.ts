/**
 * Redirecionamento das URLs legadas do checkout para o checkout unificado de oferta (`?oferta=`).
 *
 * Os parâmetros dos produtos legados (`simLinkCode`, `subscriptionLinkCode`, `simBoletoCode`,
 * `simPlanCode`, `linkCode`, `subscriptionCode`) e `?ofertaCode=` viram sempre `?oferta=`, com o
 * mesmo valor: `GET /ofertas/public/:code` resolve por código e, na falta, por id. É uma
 * retrocompatibilidade permanente, sem flag. `?code=` (plano PIX `PX-…` ou código de plano de
 * parceiro), `?data=` (base64 `{ id, token }` de link) e `?value=<código>` (link do admin) também
 * viram `?oferta=`: o endpoint público resolve código, alias `OfferCodeAlias` ou id. O pagamento
 * direto (`?value=<centavos>&description=…`) não é reescrito.
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

/** `?data=` carried a base64 `{ id, token }` of a payment link; the id is the offer id. */
function offerFromData(data: string | null): string | null {
  if (!data) return null;
  try {
    const id = JSON.parse(atob(data))?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/** `?value=` is a payment amount in the direct checkout, but a link code/id in old admin links. */
function offerFromValue(params: URLSearchParams): string | null {
  const value = params.get('value');
  if (!value || /^\d+([.,]\d+)?$/.test(value)) return null;
  if (params.get('orderNumber')) return null;
  const description = params.get('description');
  if (description && description !== 'link_avulso') return null;
  return value;
}

/** Devolve a URL de destino, ou `null` quando nada deve ser reescrito. */
export function offerRedirectTarget(url: URL): URL | null {
  const params = url.searchParams;
  if (params.get('oferta')) return null;

  const candidates: string[] = [...LEGACY_PRODUCT_PARAMS, NEW_OFFER_PARAM];
  const found = candidates.find((param) => params.get(param));
  const fromParam = found ? params.get(found) : null;
  // `?code=` is always a plan code (partner plan code = offer code, or `PX-` alias).
  const resolved =
    fromParam ??
    params.get('code') ??
    offerFromData(params.get('data')) ??
    offerFromValue(params);
  if (!resolved) return null;

  const target = new URL(url);
  target.searchParams.set('oferta', resolved);
  for (const param of [...candidates, 'code', 'data']) {
    target.searchParams.delete(param);
  }
  if (resolved === offerFromValue(params)) {
    target.searchParams.delete('value');
    if (params.get('description') === 'link_avulso')
      target.searchParams.delete('description');
  }
  return target;
}
