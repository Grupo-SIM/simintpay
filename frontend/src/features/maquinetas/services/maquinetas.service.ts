import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type {
  ListMaquinetasResponse,
  SyncMaquinetasResponse,
} from '../types/maquinetas.types';

export async function listMaquinetas(
  api: ApiClient,
  params?: {
    page?: number;
    limit?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
  },
): Promise<ListMaquinetasResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status) query.set('status', params.status);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);

  const url = query.toString()
    ? `${endpoints.maquinetas.list}?${query.toString()}`
    : endpoints.maquinetas.list;

  const res = await api.get<ListMaquinetasResponse>(url);
  return {
    transactions: res.transactions ?? [],
    meta: res.meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 },
  };
}

export async function syncMaquinetas(
  api: ApiClient,
): Promise<SyncMaquinetasResponse> {
  return api.post<SyncMaquinetasResponse>(endpoints.maquinetas.sync, {});
}
