'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { listExtrato } from '../services/extrato.service';
import type { ListExtratoQuery } from '../types/extrato.types';

export function useExtrato(query: ListExtratoQuery) {
  return useQuery({
    queryKey: ['extrato', 'list', query],
    queryFn: () =>
      listExtrato(
        createApiClient({
          baseUrl: getDefaultApiBaseUrl(),
          getToken: () => localStorage.getItem('access_token'),
        }),
        query,
      ),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}
