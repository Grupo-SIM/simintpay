import type { PlataformaTaxaKey } from './taxa-fields';

export type PlataformaTaxaSourceMap = Record<
  string,
  Partial<Record<PlataformaTaxaKey, 'env' | 'default' | 'override' | 'global'>>
>;

/** Resposta GET /admin/plataformas/taxas */
export type PlataformaTaxasGetResponse = {
  data: Record<string, Partial<Record<PlataformaTaxaKey, number>>>;
  meta?: {
    sources?: PlataformaTaxaSourceMap;
    /** Taxas DOM fixas para links de pagamento (read-only, não configuráveis). */
    domLinkRates?: Record<string, number>;
  };
};
