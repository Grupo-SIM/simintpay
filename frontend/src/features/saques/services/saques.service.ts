import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type { PaginatedResponse } from '@/services/api/types';
import type {
  Saque,
  SaquePendente,
  ListSaquesQuery,
  RequestSaqueResult,
} from '../types/saques.types';
import { withSaqueApiDateQuery } from '../utils/date-filter';

export async function listSaques(api: ApiClient, query: ListSaquesQuery) {
  const dated = withSaqueApiDateQuery(query);
  const q: Record<string, string | number | undefined> = {
    page: dated.page ?? 1,
    pageSize: dated.pageSize ?? 20,
    dataInicio: dated.dataInicio,
    dataFim: dated.dataFim,
  };
  if (dated.status && dated.status !== 'all') {
    q.status = dated.status;
  }
  return api.get<PaginatedResponse<Saque>>(endpoints.saque.list, { query: q });
}

export async function listSaquesAdmin(
  api: ApiClient,
  query: ListSaquesQuery & { modulo?: string; search?: string },
) {
  const dated = withSaqueApiDateQuery(query);
  const pageSize = dated.pageSize ?? 20;
  const q: Record<string, string | number | undefined> = {
    page: dated.page ?? 1,
    pageSize,
    limit: pageSize,
    status: dated.status,
    modulo: dated.modulo,
    search: dated.search,
    dataInicio: dated.dataInicio,
    dataFim: dated.dataFim,
    dateRange: dated.dateRange,
  };
  return api.get<PaginatedResponse<Saque>>(endpoints.admin.saques.list, {
    query: q,
  });
}

export async function approveSaque(
  api: ApiClient,
  id: string,
  receiptImage?: string | File,
) {
  if (receiptImage instanceof File) {
    const formData = new FormData();
    formData.append('file', receiptImage);
    // Note: Some API clients handle FormData specially.
    // Assuming api.post supports it or you might need a different header.
    return api.post(endpoints.admin.saques.approve(id), formData);
  }
  return api.post(endpoints.admin.saques.approve(id), { receiptImage });
}

export async function rejectSaque(api: ApiClient, id: string, motivo: string) {
  return api.post(endpoints.admin.saques.reject(id), { motivo });
}

export async function checkPendingSaque(api: ApiClient): Promise<{
  temPendente: boolean;
  saquePendente: SaquePendente | null;
}> {
  const res = await api.get<{
    data: { temPendente: boolean; saquePendente: SaquePendente | null };
  }>(endpoints.saque.checkPending);
  return res.data;
}

export async function requestSaque(
  api: ApiClient,
  input: { valor: number; chavePix: string },
): Promise<RequestSaqueResult> {
  return api.post<RequestSaqueResult>(endpoints.saque.create, input);
}

export async function getWithdrawSummary(api: ApiClient) {
  const res = await api.get<{
    data: {
      availableBalance: number;
      config: { minValor: number; taxaFixa: number };
    };
  }>(endpoints.saque.summary);
  return res.data;
}

export async function updateSaqueReceipt(
  api: ApiClient,
  id: string,
  file: File,
) {
  const formData = new FormData();
  formData.append('file', file);
  return api.patch(endpoints.admin.saques.updateReceipt(id), formData);
}

export async function toggleSaqueVisibilidade(
  api: ApiClient,
  id: string,
  visivel: boolean,
) {
  return api.patch(endpoints.admin.saques.toggleVisibilidade(id), {
    comprovanteVisivel: visivel,
  });
}
