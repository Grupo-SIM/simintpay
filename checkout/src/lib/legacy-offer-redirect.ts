/**
 * Redirecionamento das URLs legadas do checkout para o checkout unificado de oferta (`?oferta=`).
 *
 * `?ofertaCode=` (links novos) sempre vira `?oferta=`. Os parâmetros dos produtos legados
 * (`simLinkCode`, `subscriptionLinkCode`, `simBoletoCode`, `simPlanCode`, `linkCode`,
 * `subscriptionCode`) só são redirecionados com `CHECKOUT_LEGACY_TO_OFFER=true`: o público
 * `GET /ofertas/public/:code` resolve por código e, na falta, por id, mas só depois que o dono
 * migrar os produtos para `Offer` (plano 0023, fase 2). Até lá o checkout legado continua padrão.
 * `?code=PX-…` (plano PIX) não é redirecionado: o alias de código só existe nas rotas de compat.
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

export function legacyRedirectEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'on', 'yes'].includes(
    (value ?? '').trim().toLowerCase(),
  );
}

/** Devolve a URL de destino, ou `null` quando nada deve ser reescrito. */
export function offerRedirectTarget(
  url: URL,
  options: { legacyEnabled: boolean },
): URL | null {
  const params = url.searchParams;
  if (params.get('oferta')) return null;

  const candidates: string[] = [NEW_OFFER_PARAM];
  if (options.legacyEnabled) candidates.unshift(...LEGACY_PRODUCT_PARAMS);
  const found = candidates.find((param) => params.get(param));
  if (!found) return null;

  const target = new URL(url);
  target.searchParams.set('oferta', params.get(found) as string);
  for (const param of candidates) target.searchParams.delete(param);
  return target;
}
