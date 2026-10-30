import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { listMaquinetas, syncMaquinetas } from '../services/maquinetas.service';

function makeApiClient() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}

export function useMaquinetas(params?: {
  page?: number;
  limit?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
}) {
  const api = makeApiClient();

  return useQuery({
    queryKey: ['maquinetas', params],
    queryFn: () => listMaquinetas(api, params),
    staleTime: 60 * 1000,
  });
}

export function useSyncMaquinetas() {
  const queryClient = useQueryClient();
  const api = makeApiClient();

  return useMutation({
    mutationFn: () => syncMaquinetas(api),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maquinetas'] });
    },
  });
}
