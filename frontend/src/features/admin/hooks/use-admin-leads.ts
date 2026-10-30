'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import type { PaginatedResponse } from '@/services/api/types';
import { endpoints } from '@/services/api/endpoints';
import type { Lead, ListLeadsQuery } from '../types/admin.types';

type State = {
  data: PaginatedResponse<Lead>;
  loading: boolean;
  error?: string;
};

function makeApi() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}

export function useAdminLeads(query: ListLeadsQuery) {
  const [state, setState] = useState<State>({
    data: {
      data: [],
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      total: 0,
    },
    loading: true,
  });

  const requestKey = JSON.stringify([query.page, query.pageSize, query.status]);
  const [previousKey, setPreviousKey] = useState(requestKey);
  if (previousKey !== requestKey) {
    setPreviousKey(requestKey);
    setState({ ...state, loading: true, error: undefined });
  }
  const fetch = useCallback(() => {
    let active = true;

    const apiStartTime = Date.now();
    makeApi()
      .get<PaginatedResponse<Lead>>(endpoints.admin.leads.list, {
        query: {
          page: query.page,
          pageSize: query.pageSize,
          ...(query.status ? { status: query.status } : {}),
        },
      })
      .then(async (res) => {
        if (!active) return;
        const elapsed = Date.now() - apiStartTime;
        if (elapsed < 300)
          await new Promise((r) => setTimeout(r, 300 - elapsed));
        if (active) setState({ data: res, loading: false });
      })
      .catch((err) => {
        if (active)
          setState((s) => ({
            ...s,
            loading: false,
            error: err?.message ?? 'Erro ao carregar leads',
          }));
      });

    return () => {
      active = false;
    };
  }, [query.page, query.pageSize, query.status]);

  useEffect(fetch, [fetch]);

  const approveLead = useCallback(
    async (id: string) => {
      await makeApi().post(endpoints.admin.leads.approve(id));
      fetch();
    },
    [fetch],
  );

  const rejectLead = useCallback(
    async (id: string) => {
      await makeApi().post(endpoints.admin.leads.reject(id));
      fetch();
    },
    [fetch],
  );

  const deleteLeads = useCallback(
    async (ids: string[]) => {
      await makeApi().request<void>({
        path: endpoints.admin.leads.deleteMany,
        method: 'DELETE',
        body: { ids },
      });
      fetch();
    },
    [fetch],
  );

  return { ...state, approveLead, rejectLead, deleteLeads, refresh: fetch };
}
