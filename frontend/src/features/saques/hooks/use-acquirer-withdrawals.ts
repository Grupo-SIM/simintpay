'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';

export type WithdrawalFeeAcquirer = {
  code: string;
  name: string;
  active: boolean;
  feeCents: number | null;
};

export type AcquirerWithdrawal = {
  id: string;
  acquirerCode: string;
  acquirerName: string;
  feeCents: number;
  /** Data plana YYYY-MM-DD (sem fuso). */
  date: string;
  createdAt: string;
};

const QUERY_KEY = ['admin', 'acquirer-withdrawals'] as const;

function makeApiClient() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}

export function useWithdrawalFeeAcquirers() {
  return useQuery({
    queryKey: ['platforms', 'acquirers', 'fees', 'withdrawal'],
    queryFn: async () => {
      const res = await makeApiClient().get<{ data: WithdrawalFeeAcquirer[] }>(
        '/platforms/acquirers/fees/withdrawal',
      );
      return res.data ?? [];
    },
    staleTime: 60 * 1000,
  });
}

export function useAcquirerWithdrawals() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await makeApiClient().get<{ data: AcquirerWithdrawal[] }>(
        endpoints.admin.acquirerWithdrawals.list,
      );
      return res.data ?? [];
    },
    staleTime: 30 * 1000,
  });
}

export function useCreateAcquirerWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { acquirerCode: string; date: string }) =>
      makeApiClient().post(endpoints.admin.acquirerWithdrawals.create, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useUpdateAcquirerWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) =>
      makeApiClient().patch(endpoints.admin.acquirerWithdrawals.update(id), {
        date,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteAcquirerWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      makeApiClient().delete(endpoints.admin.acquirerWithdrawals.remove(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
