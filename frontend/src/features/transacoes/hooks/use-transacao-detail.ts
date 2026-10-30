'use client';

import { useEffect, useState } from 'react';

import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import type { ApiError } from '@/services/api/types';

import type { TransacaoDetail } from '../types/transacoes.types';
import { getTransacaoDetail } from '../services/transacoes.service';

type State = {
  data?: TransacaoDetail;
  loading: boolean;
  error?: ApiError;
};

export function useTransacaoDetail(id: string | undefined) {
  const [state, setState] = useState<State & { id?: string }>({
    loading: true,
  });
  if (state.id !== id) setState({ id, loading: Boolean(id) });

  useEffect(() => {
    if (!id) {
      return;
    }

    let active = true;

    const api = createApiClient({
      baseUrl: getDefaultApiBaseUrl(),
      getToken: () => localStorage.getItem('access_token'),
    });

    getTransacaoDetail(api, id)
      .then((res) => {
        if (!active) return;
        setState({ id, data: res, loading: false });
      })
      .catch((err) => {
        if (!active) return;
        setState({ id, data: undefined, loading: false, error: err });
      });

    return () => {
      active = false;
    };
  }, [id]);

  return state;
}
