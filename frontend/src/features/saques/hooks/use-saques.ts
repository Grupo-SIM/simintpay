'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import {
  listSaques,
  listSaquesAdmin,
  approveSaque,
  rejectSaque,
  checkPendingSaque,
  requestSaque,
  getWithdrawSummary,
  updateSaqueReceipt,
  toggleSaqueVisibilidade,
} from '../services/saques.service';
import type { ListSaquesQuery } from '../types/saques.types';

function makeApiClient() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}

export function useSaques(
  query: ListSaquesQuery,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['saques', 'list', query],
    queryFn: () => listSaques(makeApiClient(), query),
    staleTime: 30 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useSaquesAdmin(
  query: ListSaquesQuery & { modulo?: string; search?: string },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['saques', 'admin-list', query],
    queryFn: () => {
      const mappedStatus: ListSaquesQuery['status'] =
        query.status && query.status !== 'all'
          ? mapSaqueStatusToAdmin(query.status)
          : undefined;
      return listSaquesAdmin(makeApiClient(), {
        ...query,
        status: mappedStatus,
      });
    },
    staleTime: 30 * 1000,
    enabled: options?.enabled ?? true,
  });
}

function mapSaqueStatusToAdmin(
  status: NonNullable<ListSaquesQuery['status']>,
): NonNullable<ListSaquesQuery['status']> {
  const map: Record<string, NonNullable<ListSaquesQuery['status']>> = {
    PENDENTE: 'PENDING',
    APROVADO: 'COMPLETED',
    PAGO: 'COMPLETED',
    REJEITADO: 'REJECTED',
  };
  return map[status.toUpperCase()] ?? status;
}

export function useApproveSaque() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      receiptImage,
    }: {
      id: string;
      receiptImage?: string | File;
    }) => approveSaque(makeApiClient(), id, receiptImage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saques'] });
    },
  });
}

export function useRejectSaque() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      rejectSaque(makeApiClient(), id, motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saques'] });
    },
  });
}

export function usePendingSaque() {
  return useQuery({
    queryKey: ['saques', 'pending'],
    queryFn: () => checkPendingSaque(makeApiClient()),
    staleTime: 30 * 1000,
  });
}

export function useSaquesSummary() {
  return useQuery({
    queryKey: ['saques', 'summary'],
    queryFn: () => getWithdrawSummary(makeApiClient()),
    staleTime: 30 * 1000,
  });
}

export function useRequestSaque() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { valor: number; chavePix: string }) =>
      requestSaque(makeApiClient(), input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saques'] });
    },
  });
}

export function useUpdateSaqueReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      updateSaqueReceipt(makeApiClient(), id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saques'] });
    },
  });
}

export function useToggleComprovanteVisivel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, visivel }: { id: string; visivel: boolean }) =>
      toggleSaqueVisibilidade(makeApiClient(), id, visivel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saques'] });
    },
  });
}
