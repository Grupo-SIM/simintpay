'use client';

import { CoproductionButton } from '@/components/coproduction';

import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PlatformSettingsModal } from './PlatformSettingsModal';
import { useState } from 'react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useQuery } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { PlatformSelectionHeader } from './PlatformSelectionHeader';
import { PlatformRateEditor } from './PlatformRateEditor';
import { panel, type Platform } from './types';

export function PlatformManager({
  selectedTag,
}: { selectedTag?: string } = {}) {
  const [selection, setSelection] = useState('');
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const api = useClienteApi();
  const { user, loading } = useCurrentUser();
  const query = useQuery({
    queryKey: [user?.isAdmin ? 'admin-platforms' : 'owned-platforms', user?.id],
    enabled: Boolean(user),
    queryFn: () =>
      api.get<{ data: Platform[] }>(
        user?.isAdmin ? '/platforms' : '/platforms/owned',
      ),
  });
  if (loading || (Boolean(user) && query.isPending))
    return (
      <div
        aria-label="Carregando plataformas"
        className="animate-pulse space-y-5"
      >
        <div className="h-28 rounded-xl bg-zinc-200 dark:bg-white/10" />
        <div className="h-96 rounded-xl bg-zinc-200 dark:bg-white/10" />
      </div>
    );
  if (!user || query.isError)
    return (
      <div role="alert" className={panel}>
        Não foi possível carregar plataformas.{' '}
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="cursor-pointer rounded border px-3 py-2"
        >
          Tentar novamente
        </button>
      </div>
    );
  const platforms = query.data!.data;
  const selected =
    platforms.find((row) => row.tag === (selectedTag ?? selection)) ??
    (!selectedTag ? platforms[0] : undefined);
  const actions =
    selected?.id &&
    !selected.coproducao?.readOnly &&
    selected.coproducao?.role !== 'COPRODUCER' ? (
      <>
        <CoproductionButton product="plataformas" productId={selected.id} />
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer"
          onClick={() => setSettingsId(selected.id)}
        >
          <Settings size={16} />
          Configurações
        </Button>
      </>
    ) : null;
  return (
    <div className="space-y-5">
      {!selectedTag && (
        <PlatformSelectionHeader
          platforms={platforms}
          selectedTag={selected?.tag}
          onSelect={setSelection}
          actions={actions}
        />
      )}
      {selectedTag && actions && (
        <div className="flex justify-end gap-3">{actions}</div>
      )}
      {selected?.id &&
        !selected.coproducao?.readOnly &&
        selected.coproducao?.role !== 'COPRODUCER' &&
        settingsId === selected.id && (
          <PlatformSettingsModal
            key={selected.id}
            platformId={selected.id}
            name={selected.name}
            onClose={() => setSettingsId(null)}
          />
        )}
      {selected ? (
        <PlatformRateEditor
          key={`${selected.tag}-${selected.absorbCustomerInterest}`}
          platform={selected}
        />
      ) : (
        <p className={panel}>
          {selectedTag
            ? 'Plataforma não disponível para gerenciamento.'
            : 'Nenhuma plataforma cadastrada. Crie sua primeira plataforma para associar produtos.'}
        </p>
      )}
    </div>
  );
}
