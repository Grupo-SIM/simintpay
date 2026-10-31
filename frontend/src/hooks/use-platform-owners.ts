'use client';

import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import type { PlatformOwnership } from '@/lib/product-platforms';

type Owner = { id: string; name: string; email?: string };
type PlatformOwnerPage = {
  data: { owner: Owner }[];
  total: number;
  pageSize: number;
};

export function usePlatformOwners() {
  const { user } = useCurrentUser();
  const api = useClienteApi();
  const query = useQuery({
    queryKey: ['platform-owners', 'platform-balances', user?.id],
    enabled: Boolean(user?.isAdmin),
    queryFn: async () => {
      const owners = new Map<string, Owner>();
      for (let page = 1; ; page++) {
        const result = await api.get<PlatformOwnerPage>(
          '/admin/relatorios/saldos-plataformas',
          { query: { page, pageSize: 12 } },
        );
        for (const { owner } of result.data) owners.set(owner.id, owner);
        if (result.data.length === 0 || page * result.pageSize >= result.total)
          break;
      }
      return owners;
    },
    staleTime: 60_000,
  });
  const resolve = <T extends PlatformOwnership>(platform: T): T => {
    const id = platform.ownerUserId ?? platform.owner?.id;
    return {
      ...platform,
      owner: platform.owner?.name
        ? platform.owner
        : ((id ? query.data?.get(id) : undefined) ?? platform.owner),
    };
  };
  return {
    resolve,
    isLoading: Boolean(user?.isAdmin) && query.isPending,
    isError: Boolean(user?.isAdmin) && query.isError,
    retry: () => {
      void query.refetch();
    },
  };
}
