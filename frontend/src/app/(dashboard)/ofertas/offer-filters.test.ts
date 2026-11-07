import { describe, expect, test } from 'bun:test';
import {
  emptyOfferFilters,
  filtersFromParams,
  filtersToApiQuery,
  filtersToParams,
  hasActiveFilters,
  normalizeListResponse,
  screenFromParams,
  screenHref,
} from './offer-filters';

const parse = (qs: string) => filtersFromParams(new URLSearchParams(qs));

describe('offer filters', () => {
  test('url vazia = filtros padrão, e filtros padrão = url vazia', () => {
    expect(parse('')).toEqual(emptyOfferFilters);
    expect(filtersToParams(emptyOfferFilters).toString()).toBe('');
    expect(hasActiveFilters(emptyOfferFilters)).toBe(false);
  });

  test('round trip pela query string', () => {
    const filters = {
      search: 'mentoria',
      ownerSearch: 'ana@example.test',
      kind: 'PIX_PLAN' as const,
      status: 'EXHAUSTED' as const,
      platformTag: 'GLOBAL',
      paymentMethod: 'BOLETO' as const,
      renewalMode: 'MANUAL_PAY' as const,
      page: 3,
    };
    expect(parse(filtersToParams(filters).toString())).toEqual(filters);
    expect(hasActiveFilters({ ...emptyOfferFilters, page: 4 })).toBe(false);
    expect(hasActiveFilters({ ...emptyOfferFilters, kind: 'PLAN' })).toBe(true);
  });

  test('valores inválidos na URL são ignorados', () => {
    expect(
      parse('tipo=NOPE&status=x&meio=CASH&recorrencia=y&pagina=-2'),
    ).toEqual(emptyOfferFilters);
    expect(parse('pagina=abc').page).toBe(1);
  });

  test('query da API: paginada, mais novas primeiro, só o que foi filtrado', () => {
    expect(filtersToApiQuery(emptyOfferFilters)).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'newest',
    });
    expect(
      filtersToApiQuery({
        ...emptyOfferFilters,
        search: ' abc ',
        status: 'EXPIRED',
        renewalMode: 'AUTO_CHARGE',
        page: 2,
      }),
    ).toEqual({
      page: 2,
      pageSize: 20,
      sort: 'newest',
      search: 'abc',
      status: 'EXPIRED',
      renewalMode: 'AUTO_CHARGE',
    });
  });

  test('aceita a lista simples do backend antigo', () => {
    const result = normalizeListResponse([{ id: 'a' }] as never, { page: 1 });
    expect(result.meta.total).toBe(1);
    const paged = {
      data: [],
      meta: { page: 2, pageSize: 20, total: 0, totalPages: 1 },
    };
    expect(normalizeListResponse(paged, { page: 2 })).toBe(paged);
  });

  test('tela por ?novo=1 e ?editar=id, preservando filtros', () => {
    expect(screenFromParams(new URLSearchParams(''))).toEqual({
      mode: 'list',
    });
    expect(screenFromParams(new URLSearchParams('novo=1'))).toEqual({
      mode: 'create',
    });
    expect(screenFromParams(new URLSearchParams('editar=abc'))).toEqual({
      mode: 'edit',
      id: 'abc',
    });
    expect(screenFromParams(new URLSearchParams('novo=0'))).toEqual({
      mode: 'list',
    });
    const filters = { ...emptyOfferFilters, kind: 'PLAN' as const };
    expect(screenHref({ mode: 'list' }, filters)).toBe('/ofertas?tipo=PLAN');
    expect(screenHref({ mode: 'edit', id: 'x y' }, filters)).toBe(
      '/ofertas?tipo=PLAN&editar=x+y',
    );
    expect(screenHref({ mode: 'create' }, emptyOfferFilters)).toBe(
      '/ofertas?novo=1',
    );
  });
});
