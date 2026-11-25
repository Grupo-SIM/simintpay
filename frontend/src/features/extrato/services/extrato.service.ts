import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type { ExtratoResponse, ListExtratoQuery } from '../types/extrato.types';

export function listExtrato(api: ApiClient, query: ListExtratoQuery) {
  return api.get<ExtratoResponse>(endpoints.extrato.list, {
    query: {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      dataInicio: query.dataInicio,
      dataFim: query.dataFim,
      tipo: query.tipo,
      natureza: query.natureza,
      busca: query.busca,
    },
  });
}
