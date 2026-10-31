'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { useToast } from '@/components/ui/Toast';
import {
  AdditiveFeeFormModal,
  type AdditiveFeeInput,
} from './AdditiveFeeFormModal';
import {
  formatFeeValue,
  DISPLAY_MODE_LABELS,
  SCOPE_LABELS,
  type AdditiveFee,
} from './financial-types';

/** Global catalog management (admin only). Calls apply immediately; they do not use the policy draft. */
export function AdditiveFeeCatalog() {
  const api = useClienteApi(),
    queryClient = useQueryClient(),
    { toast } = useToast();
  const [editing, setEditing] = useState<AdditiveFee | 'new' | null>(null);
  const catalog = useQuery({
    queryKey: ['additive-fees'],
    queryFn: () => api.get<{ data: AdditiveFee[] }>('/platforms/additive-fees'),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['additive-fees'] });
    await queryClient.invalidateQueries({ queryKey: ['financial-policy'] });
  };
  const save = useMutation({
    mutationFn: (input: AdditiveFeeInput) =>
      editing && editing !== 'new'
        ? api.patch(`/platforms/additive-fees/${editing.id}`, input)
        : api.post('/platforms/additive-fees', input),
    onSuccess: async () => {
      await refresh();
      setEditing(null);
      toast({ type: 'success', title: 'Taxa adicional salva' });
    },
    onError: (error: Error) =>
      toast({ type: 'error', title: error.message || 'Falha ao salvar taxa' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/platforms/additive-fees/${id}`),
    onSuccess: async () => {
      await refresh();
      toast({ type: 'success', title: 'Taxa adicional excluída' });
    },
    onError: (error: Error) =>
      toast({
        type: 'error',
        title: error.message || 'Falha ao excluir taxa',
      }),
  });
  return (
    <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">
        Catálogo de taxas adicionais
      </legend>
      <p className="text-sm text-zinc-500">
        Acréscimos somados ao preço do comprador. Cada plataforma associa as
        taxas que deseja cobrar.
      </p>
      {catalog.isPending ? (
        <div
          role="status"
          aria-label="Carregando taxas adicionais"
          className="h-16 animate-pulse rounded-lg bg-zinc-200 dark:bg-white/10"
        />
      ) : catalog.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          Falha ao carregar o catálogo.
          <Button
            type="button"
            variant="outline"
            onClick={() => void catalog.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-white/10">
          {catalog.data.data.length === 0 && (
            <li className="py-2 text-sm text-zinc-500">
              Nenhuma taxa adicional cadastrada.
            </li>
          )}
          {catalog.data.data.map((fee) => (
            <li key={fee.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {fee.name}
                  {!fee.active && (
                    <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                      Inativa
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500">
                  {formatFeeValue(fee.percentageValue, fee.fixedValue)} ·{' '}
                  {SCOPE_LABELS[fee.applicationScope]} ·{' '}
                  {DISPLAY_MODE_LABELS[fee.displayMode]}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Editar ${fee.name}`}
                title="Editar"
                className="cursor-pointer"
                onClick={() => setEditing(fee)}
              >
                <Pencil size={16} />
              </Button>
              <ConfirmActionButton
                variant="outline"
                size="icon"
                label={`Excluir ${fee.name}`}
                confirmation="Excluir esta taxa para todas as plataformas?"
                confirmContent={<Trash2 size={16} />}
                onConfirm={() => remove.mutate(fee.id)}
              >
                <Trash2 size={16} />
              </ConfirmActionButton>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        className="cursor-pointer"
        onClick={() => setEditing('new')}
      >
        <Plus size={16} /> Nova taxa adicional
      </Button>
      {editing && (
        <AdditiveFeeFormModal
          fee={editing === 'new' ? undefined : editing}
          saving={save.isPending}
          onSave={(input) => save.mutate(input)}
          onClose={() => setEditing(null)}
        />
      )}
    </fieldset>
  );
}
