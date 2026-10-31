'use client';

import { useQuery } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PlatformSettingsForm } from './components';
import type { PlatformIntegrationSettings } from './types';

export function PlatformSettingsModal({
  platformId,
  name,
  onClose,
}: {
  platformId: string;
  name: string;
  onClose: () => void;
}) {
  const api = useClienteApi();
  const { user } = useCurrentUser();
  const query = useQuery({
    queryKey: ['platform-integration-settings', user?.id, platformId],
    enabled: Boolean(user),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () =>
      api.get<{ data: PlatformIntegrationSettings }>(
        `/platforms/${encodeURIComponent(platformId)}/integrations/settings`,
        { cache: 'no-store' },
      ),
  });
  return (
    <Modal
      open
      title={`Configurações — ${name}`}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      {query.isPending ? (
        <div
          aria-label="Carregando configurações"
          className="animate-pulse space-y-5"
        >
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="space-y-2">
              <div className="h-5 w-40 rounded bg-zinc-200 dark:bg-white/10" />
              <div className="h-12 rounded-lg bg-zinc-200 dark:bg-white/10" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <div role="alert" className="space-y-3">
          <p>Não foi possível carregar configurações.</p>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={() => void query.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : (
        <PlatformSettingsForm
          platformId={platformId}
          settings={query.data.data}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
