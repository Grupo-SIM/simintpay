'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';

export function useReportApi() {
  return useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token'),
      }),
    [],
  );
}

/** Isolate report caches across identities and roles, including legacy admin panels. */
export const useReportQuery: typeof useQuery = ((
  options: Parameters<typeof useQuery>[0],
  client?: Parameters<typeof useQuery>[1],
) => {
  const { user } = useCurrentUser();
  return useQuery(
    {
      ...options,
      queryKey: [
        'reports',
        user?.id,
        user?.isAdmin ? 'admin' : 'owner',
        ...options.queryKey,
      ],
      enabled: user ? options.enabled : false,
    },
    client,
  );
}) as typeof useQuery;
