'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlatformOwners } from '@/hooks/use-platform-owners';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';

import {
  productPlatformOptions,
  type ProductPlatform,
} from '@/lib/product-platforms';

export function useProductPlatforms() {
  const [financialOwner, setFinancialOwner] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const owners = usePlatformOwners();
  const { user, loading } = useCurrentUser();
  const query = useQuery({
    queryKey: ['product-platforms', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token'),
      });
      return (await api.get<{ data: ProductPlatform[] }>('/platforms')).data;
    },
  });
  const platforms = (query.data ?? []).map(owners.resolve);
  const options = productPlatformOptions(platforms, user);
  return {
    financialOwner,
    setFinancialOwner,
    isDestinationValid: (tag: string | null) =>
      !loading &&
      !query.isPending &&
      !query.isError &&
      !owners.isLoading &&
      !owners.isError &&
      (tag
        ? options.some((option) => option.value === tag && !option.disabled)
        : Boolean(user?.isAdmin && financialOwner)),
    destinationBody: (tag: string | null) => ({
      ...(tag ? { plataformas: [tag] } : { plataformas: [] }),
      ...(!tag && user?.isAdmin && financialOwner
        ? { ownerUserId: financialOwner.id }
        : {}),
    }),
    options,
    platforms,
    user,
    selectableTags: options
      .filter((option) => !option.disabled)
      .map((option) => option.value),
    isLoading:
      loading || owners.isLoading || (Boolean(user) && query.isPending),
    isError: !loading && (!user || query.isError || owners.isError),
    retry: () => {
      void query.refetch();
      owners.retry();
    },
  };
}
