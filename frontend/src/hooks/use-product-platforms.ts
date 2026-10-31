'use client';

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
