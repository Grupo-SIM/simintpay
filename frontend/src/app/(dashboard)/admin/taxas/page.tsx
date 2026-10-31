'use client';

import { CoproductionButton } from '@/components/coproduction';
import { usePlatformOwners } from '@/hooks/use-platform-owners';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { FinancialPolicyEditor } from '@/components/platforms/FinancialPolicyEditor';
import { FinancialWithdrawalSettings } from '@/components/platforms/FinancialWithdrawalSettings';
import { PlatformSelectionHeader } from '@/components/platforms/PlatformSelectionHeader';
import type { Platform } from '@/components/platforms/types';

export default function AdminTaxasPlataformasPage() {
  const owners = usePlatformOwners();
  const { user, loading } = useCurrentUser();
  const api = useClienteApi();
  const [tag, setTag] = useState('GLOBAL');
  const platforms = useQuery({
    queryKey: ['admin-platforms', user?.id],
    enabled: !!user?.isAdmin,
    queryFn: () => api.get<{ data: Platform[] }>('/platforms'),
  });
  if (loading)
    return (
      <div
        role="status"
        aria-label="Verificando acesso"
        className="h-80 animate-pulse rounded-xl bg-zinc-200 dark:bg-white/10"
      />
    );
  if (!user?.isAdmin)
    return <p role="alert">Acesso exclusivo do administrador.</p>;
  if (platforms.isPending || owners.isLoading)
    return (
      <div
        role="status"
        aria-label="Carregando plataformas"
        className="h-80 animate-pulse rounded-xl bg-zinc-200 dark:bg-white/10"
      />
    );
  if (platforms.isError || owners.isError)
    return (
      <p role="alert">
        Falha ao carregar plataformas.{' '}
        <button
          type="button"
          className="cursor-pointer rounded border p-2"
          onClick={() => {
            void platforms.refetch();
            owners.retry();
          }}
        >
          Tentar novamente
        </button>
      </p>
    );
  const selectedPlatform = platforms.data.data.find(
    (platform) => platform.tag === tag,
  );
  const selectedName =
    tag === 'GLOBAL' ? 'Padrão global' : (selectedPlatform?.name ?? tag);
  return (
    <div className="space-y-5">
      <PlatformSelectionHeader
        platforms={platforms.data.data}
        selectedTag={tag}
        admin
        onSelect={setTag}
      />
      {selectedPlatform?.id && (
        <div className="flex justify-end">
          <CoproductionButton
            product="plataformas"
            productId={selectedPlatform.id}
          />
        </div>
      )}
      <FinancialPolicyEditor key={tag} tag={tag} name={selectedName} admin />
      <FinancialWithdrawalSettings key={`withdrawal-${tag}`} tag={tag} />
    </div>
  );
}
