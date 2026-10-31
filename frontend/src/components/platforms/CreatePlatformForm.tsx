'use client';

import { useCurrentUser } from '@/hooks/use-current-user';
import { PlatformOwnerSelect } from './PlatformOwnerSelect';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { PlatformField } from './PlatformField';
import { type Platform } from './types';

export function CreatePlatformForm({
  onCreated,
  onCancel,
}: {
  onCreated: (tag: string) => void;
  onCancel: () => void;
}) {
  const { user } = useCurrentUser();
  const [owner, setOwner] = useState<{
    id: string;
    name: string;
    email: string;
    isAdmin?: boolean;
  } | null>(null);
  const ownerValid = Boolean(
    user &&
    (!user.isAdmin || (owner && owner.id !== user.id && !owner.isAdmin)),
  );
  const [name, setName] = useState('');
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const tag = (
    normalized
      ? /^[A-Z]/.test(normalized)
        ? normalized
        : `PLATAFORMA-${normalized}`
      : ''
  )
    .slice(0, 50)
    .replace(/-+$/g, '');
  const identifier = tag.length === 1 ? `PLATAFORMA-${tag}` : tag;
  const api = useClienteApi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({
    mutationFn: () => {
      if (!ownerValid)
        throw new Error('Selecione uma conta cliente proprietária.');
      return api.post<{ data: Platform }>('/platforms', {
        name: name.trim(),
        tag: identifier,
        ...(user?.isAdmin ? { ownerUserId: owner!.id } : {}),
      });
    },
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owned-platforms'] }),
        queryClient.invalidateQueries({ queryKey: ['product-platforms'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-platforms'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-owners'] }),
      ]);
      setName('');
      onCreated(response.data.tag);
      toast({
        type: 'success',
        title: 'Plataforma criada',
        description: 'Regras e taxas padrão aplicadas.',
      });
    },
    onError: (error) =>
      toast({
        type: 'error',
        title: 'Não foi possível criar',
        description: error.message,
      }),
  });
  return (
    <section
      aria-label="Nova plataforma"
      className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-white/10 dark:bg-white/5"
    >
      <h4 className="font-semibold">Criar plataforma</h4>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !create.isPending &&
            ownerValid &&
            name.trim() &&
            /^[A-Z][A-Z0-9-]{1,49}$/.test(identifier)
          )
            create.mutate();
        }}
      >
        <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          Nova plataforma herda regras e custos padrão da SimIntPay. Depois,
          ajuste os juros cobrados dos compradores.
        </p>
        <div className="grid gap-4">
          {user?.isAdmin && (
            <PlatformOwnerSelect
              owner={owner}
              disabled={create.isPending}
              onChange={setOwner}
            />
          )}
          <PlatformField
            label="Nome"
            name="platform-name"
            required
            placeholder="Ex: Minha loja"
            value={name}
            onChange={setName}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={create.isPending}
            className="cursor-pointer rounded-xl disabled:cursor-not-allowed"
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <button
            type="submit"
            disabled={
              create.isPending ||
              !ownerValid ||
              !name.trim() ||
              !/^[A-Z][A-Z0-9-]{1,49}$/.test(identifier)
            }
            className="flex cursor-pointer items-center gap-2 rounded-xl border border-violet-500 bg-violet-600 transition-colors hover:bg-violet-500 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} />
            {create.isPending ? 'Criando…' : 'Criar plataforma'}
          </button>
        </div>
      </form>
    </section>
  );
}
