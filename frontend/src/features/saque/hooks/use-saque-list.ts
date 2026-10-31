'use client';

import { useEffect, useState } from 'react';

import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import type { ApiError } from '@/services/api/types';

import type { ListSaquesQuery, Saque } from '../types/saque.types';
import { listSaques } from '../services/saque.service';

type State = {
  data: Saque[];
  loading: boolean;
  error?: ApiError;
};

export function useSaqueList(query: ListSaquesQuery) {
  const requestKey = JSON.stringify([query.page, query.pageSize, query.status]);
  const [state, setState] = useState<State & { requestKey: string }>({
    data: [],
    loading: true,
    requestKey,
  });
  if (state.requestKey !== requestKey) {
    setState({ ...state, requestKey, loading: true, error: undefined });
  }

  useEffect(() => {
    let active = true;

    const api = createApiClient({
      baseUrl: getDefaultApiBaseUrl(),
      getToken: () => localStorage.getItem('access_token'),
    });

    listSaques(api, query)
      .then((res) => {
        if (!active) return;
        setState({ requestKey, data: res.data, loading: false });
      })
      .catch((err) => {
        if (!active) return;
        setState({ requestKey, data: [], loading: false, error: err });
      });

    return () => {
      active = false;
    };
  }, [query.page, query.pageSize, query.status]);

  return state;
}
