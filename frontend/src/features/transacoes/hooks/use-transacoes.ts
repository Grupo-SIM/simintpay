import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import type { ListTransacoesQuery } from '../types/transacoes.types';
import { listTransacoes } from '../services/transacoes.service';

export function useTransacoes(query: ListTransacoesQuery) {
  const queryClient = useQueryClient();

  const api = createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });

  // REAL-TIME (SSE) — para Renovada; admin recebe via webhook no banco
  useEffect(() => {
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('access_token')
        : null;
    if (!token) return;

    const url = new URL(
      '/admin/renovada/real-time/transactions',
      getDefaultApiBaseUrl(),
    );
    const eventSource = new EventSource(url.toString());

    eventSource.addEventListener('new-transaction', () => {
      queryClient.invalidateQueries({ queryKey: ['transacoes'] });
    });

    return () => {
      eventSource.close();
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ['transacoes', 'ledger', query],
    enabled: query.enabled !== false,
    queryFn: () => {
      return listTransacoes(api, query);
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}
