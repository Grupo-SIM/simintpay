'use client';

import { useEffect, useState } from 'react';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  cpf?: string | null;
  cnpj?: string | null;
  isAdmin: boolean;
  /** Definido pelo GET /auth/me (back-simpay). */
  isMasterAdmin?: boolean;
  /** Cliente SimintPay (auto-cadastrado). */
  isClient?: boolean;
  clientStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  /** Definido pelo GET /auth/me (back-simpay). */
  isAffiliate?: boolean;
  affiliateCode?: string | null;
  tenantModule: { slug: string; name: string } | null;
  modulo?: { slug: string; name: string } | null;
  wallet?: {
    balance: number;
    lockedBalance: number;
    availableBalance: number;
    netBalance: number;
  };
};

// Module-level cache to avoid multiple API calls across components
let cachedUser: CurrentUser | null = null;
let cachePromise: Promise<CurrentUser | null> | null = null;

function fetchCurrentUser(): Promise<CurrentUser | null> {
  const token = localStorage.getItem('access_token');
  if (!token) return Promise.resolve(null);

  const api = createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => token,
  });

  return api
    .get<{ data: CurrentUser }>('/auth/me')
    .then((res) => res.data)
    .catch(() => null);
}

export function clearUserCache() {
  cachedUser = null;
  cachePromise = null;
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(cachedUser);
  const [loading, setLoading] = useState(!cachedUser);

  useEffect(() => {
    if (!cachePromise) {
      cachePromise = (
        cachedUser ? Promise.resolve(cachedUser) : fetchCurrentUser()
      ).then((u) => {
        cachedUser = u;
        return u;
      });
    }

    cachePromise.then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  return { user, loading };
}
