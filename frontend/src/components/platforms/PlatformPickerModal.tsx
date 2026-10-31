'use client';

import { usePlatformOwners } from '@/hooks/use-platform-owners';
import { useCurrentUser } from '@/hooks/use-current-user';
import { platformOwnerLabel } from '@/lib/product-platforms';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Layers, Plus, Search, Trash2 } from 'lucide-react';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { Button } from '@/components/ui/Button';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { CreatePlatformForm } from './CreatePlatformForm';
import type { Platform } from './types';

type Props = {
  platforms: Platform[];
  selectedTag?: string;
  onSelect: (tag: string) => void;
  onClose: () => void;
  admin?: boolean;
  label?: (platform: Platform) => string;
};

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

export function PlatformPickerModal({
  platforms,
  selectedTag,
  onSelect,
  onClose,
  admin = false,
  label,
}: Props) {
  const owners = usePlatformOwners();
  const { user } = useCurrentUser();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [localSearch, updateSearch, flushSearch] = useDebouncedInput(
    search,
    setSearch,
  );
  const api = useClienteApi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const remove = useMutation({
    mutationFn: (tag: string) =>
      api.delete(`/platforms/${encodeURIComponent(tag)}`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owned-platforms'] }),
        queryClient.invalidateQueries({ queryKey: ['product-platforms'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-platforms'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-owners'] }),
      ]);
      toast({ type: 'success', title: 'Plataforma excluída' });
    },
    onError: (error) =>
      toast({
        type: 'error',
        title: 'Não foi possível excluir',
        description: error.message,
      }),
  });
  const filtered = platforms
    .map(owners.resolve)
    .filter((platform) =>
      normalize(
        `${platform.name} ${platform.tag} ${user?.isAdmin ? platformOwnerLabel(platform, user) : ''}`,
      ).includes(normalize(search.trim())),
    );

  return (
    <Modal
      open
      title={admin ? 'Configuração financeira' : 'Plataformas'}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <div
        role="dialog"
        aria-label={
          admin ? 'Selecionar configuração financeira' : 'Gerenciar plataformas'
        }
        className="space-y-5 text-zinc-900 dark:text-zinc-100"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Layers size={22} />
          </span>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {admin
              ? 'Selecione o padrão global ou uma plataforma para configurar exceções de taxas e juros SimIntPay.'
              : 'Selecione uma plataforma para gerenciar suas regras e taxas.'}
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="platform-search" className="text-sm font-medium">
            Pesquisar plataformas
          </label>
          <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 focus-within:border-violet-400/40 focus-within:ring-4 focus-within:ring-violet-500/10 dark:border-white/10 dark:bg-white/5">
            <Search size={18} className="shrink-0 text-zinc-400" />
            <input
              id="platform-search"
              name="platform-search"
              type="text"
              placeholder="Ex: Minha loja"
              value={localSearch}
              onChange={(event) => updateSearch(event.currentTarget.value)}
              onBlur={flushSearch}
              className="h-11 min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </div>
        </div>
        <ScrollArea
          className="max-h-64 space-y-2 pr-1"
          aria-label="Plataformas disponíveis"
        >
          {admin && (
            <button
              type="button"
              onClick={() => onSelect('GLOBAL')}
              aria-pressed={selectedTag === 'GLOBAL'}
              className="flex w-full cursor-pointer items-center justify-between rounded-xl border p-4 text-left"
            >
              Padrão global{selectedTag === 'GLOBAL' && <Check size={18} />}
            </button>
          )}
          {filtered.map((platform) => (
            <div key={platform.tag} className="flex items-center gap-2">
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => onSelect(platform.tag)}
                aria-pressed={selectedTag === platform.tag}
                className={`flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:border-violet-400/40 hover:bg-violet-500/5 disabled:cursor-not-allowed ${selectedTag === platform.tag ? 'border-violet-500/40 bg-violet-500/10' : 'border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-white/5'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {label
                      ? label(platform)
                      : `${platform.name}${!platform.isActive ? ' (Inativa)' : ''}`}
                  </span>
                  {(platform.coproducao?.readOnly ||
                    platform.coproducao?.role === 'COPRODUCER') && (
                    <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      Coprodução · Somente leitura
                    </span>
                  )}
                  {user?.isAdmin && (
                    <span className="mt-1 block break-words text-xs text-zinc-500 dark:text-zinc-400">
                      {owners.isLoading
                        ? 'Carregando proprietário…'
                        : platformOwnerLabel(platform, user)}
                    </span>
                  )}
                </span>
                {selectedTag === platform.tag && (
                  <Check size={18} className="shrink-0 text-violet-500" />
                )}
              </button>
              {!admin &&
                !platform.coproducao?.readOnly &&
                platform.coproducao?.role !== 'COPRODUCER' && (
                  <ConfirmActionButton
                    variant="outline"
                    size="icon"
                    className="cursor-pointer text-red-500 disabled:cursor-not-allowed"
                    disabled={remove.isPending}
                    label={`Excluir ${platform.name}`}
                    confirmation="Excluir permanentemente esta plataforma?"
                    confirmContent={<Check size={16} />}
                    onConfirm={() => remove.mutate(platform.tag)}
                  >
                    <Trash2 size={16} />
                  </ConfirmActionButton>
                )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
              {platforms.length
                ? 'Nenhuma plataforma encontrada.'
                : 'Nenhuma plataforma cadastrada.'}
            </p>
          )}
        </ScrollArea>
        {!admin && (
          <div className="border-t border-zinc-200 pt-5 dark:border-white/10">
            {creating ? (
              <CreatePlatformForm
                onCreated={onSelect}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                aria-expanded={false}
                className="h-11 w-full cursor-pointer rounded-xl border-violet-500/30 text-violet-600 hover:bg-violet-500/10 dark:text-violet-400"
                onClick={() => setCreating(true)}
              >
                <Plus size={18} />
                Criar plataforma
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
