import {
  OFFER_METHODS,
  OFFER_STATUSES,
  type Offer,
  type OfferMethod,
  type OfferRenewal,
  type OfferStatus,
} from './offers';

export const OFFER_PAGE_SIZE = 20;
const RENEWALS: OfferRenewal[] = ['NONE', 'AUTO_CHARGE', 'MANUAL_PAY'];

/** Filtros da listagem; '' = sem filtro. Os valores são os mesmos do GET /ofertas. */
export type OfferFilters = {
  search: string;
  ownerSearch: string;
  status: OfferStatus | '';
  platformTag: string;
  paymentMethod: OfferMethod | '';
  renewalMode: OfferRenewal | '';
  page: number;
};

export const emptyOfferFilters: OfferFilters = {
  search: '',
  ownerSearch: '',
  status: '',
  platformTag: '',
  paymentMethod: '',
  renewalMode: '',
  page: 1,
};

const oneOf = <T extends string>(
  allowed: readonly T[],
  value: string | null,
): T | '' => (allowed.includes(value as T) ? (value as T) : '');

type Params = Pick<URLSearchParams, 'get'>;

/** Lê os filtros da URL; valores inválidos são ignorados em vez de quebrar a tela. */
export function filtersFromParams(params: Params): OfferFilters {
  const page = Number(params.get('pagina'));
  return {
    search: (params.get('busca') ?? '').slice(0, 120),
    ownerSearch: (params.get('dono') ?? '').slice(0, 120),
    status: oneOf(OFFER_STATUSES, params.get('status')),
    platformTag: params.get('plataforma') ?? '',
    paymentMethod: oneOf(OFFER_METHODS, params.get('meio')),
    renewalMode: oneOf(RENEWALS, params.get('recorrencia')),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Parâmetros de URL só com o que difere do padrão (URL curta e linkável). */
export function filtersToParams(filters: OfferFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => value && params.set(key, value);
  set('busca', filters.search.trim());
  set('dono', filters.ownerSearch.trim());
  set('status', filters.status);
  set('plataforma', filters.platformTag);
  set('meio', filters.paymentMethod);
  set('recorrencia', filters.renewalMode);
  if (filters.page > 1) params.set('pagina', String(filters.page));
  return params;
}

/** Query do GET /ofertas (sempre paginada, mais novas primeiro). */
export function filtersToApiQuery(
  filters: OfferFilters,
): Record<string, string | number> {
  const query: Record<string, string | number> = {
    page: filters.page,
    pageSize: OFFER_PAGE_SIZE,
    sort: 'newest',
  };
  const search = filters.search.trim();
  if (search) query.search = search;
  if (filters.ownerSearch.trim())
    query.ownerSearch = filters.ownerSearch.trim();
  if (filters.status) query.status = filters.status;
  if (filters.platformTag) query.platformTag = filters.platformTag;
  if (filters.paymentMethod) query.paymentMethod = filters.paymentMethod;
  if (filters.renewalMode) query.renewalMode = filters.renewalMode;
  return query;
}

export const hasActiveFilters = (filters: OfferFilters) =>
  filtersToParams({ ...filters, page: 1 }).size > 0;

export type OfferListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
export type OfferListResponse = { data: Offer[]; meta: OfferListMeta };

/** Aceita o formato paginado e, por compatibilidade, a lista simples do backend antigo. */
export function normalizeListResponse(
  response: OfferListResponse | Offer[],
  filters: Pick<OfferFilters, 'page'>,
): OfferListResponse {
  if (Array.isArray(response))
    return {
      data: response,
      meta: {
        page: filters.page,
        pageSize: response.length || OFFER_PAGE_SIZE,
        total: response.length,
        totalPages: 1,
      },
    };
  return response;
}

/** Rotas das telas de ofertas; os filtros da listagem viajam na querystring para voltar ao mesmo recorte. */
export const offerRoutes = {
  create: (filters: OfferFilters = emptyOfferFilters) =>
    withFilters('/ofertas/criar', filters),
  edit: (id: string, filters: OfferFilters = emptyOfferFilters) =>
    withFilters(`/ofertas/${encodeURIComponent(id)}/editar`, filters),
  list: (filters: OfferFilters = emptyOfferFilters) =>
    withFilters('/ofertas', filters),
};

function withFilters(base: string, filters: OfferFilters): string {
  const qs = filtersToParams(filters).toString();
  return qs ? `${base}?${qs}` : base;
}
