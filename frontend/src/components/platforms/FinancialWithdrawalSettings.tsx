'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { useToast } from '@/components/ui/Toast';
import { FinancialNumberField } from './FinancialNumberField';
import { panel } from './types';

/** Withdrawals remain independent of the sale policy and keep their existing contract. */
export function FinancialWithdrawalSettings({ tag }: { tag: string }) {
  const api = useClienteApi(),
    client = useQueryClient(),
    { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const path = `/admin/plataformas/taxas/${encodeURIComponent(tag)}`;
  const query = useQuery({
    queryKey: ['withdrawal-settings', tag],
    queryFn: () =>
      api.get<{ data: Record<string, Record<string, number>> }>(path),
  });
  const save = useMutation({
    mutationFn: () =>
      api.patch(
        path,
        Object.fromEntries(
          Object.entries(draft).map(([key, cents]) => [key, cents / 100]),
        ),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['withdrawal-settings', tag],
      });
      setDraft({});
      toast({ type: 'success', title: 'Condições de saque salvas' });
    },
    onError: (error: Error) =>
      toast({
        type: 'error',
        title: 'Falha ao salvar saque',
        description: error.message,
      }),
  });
  if (query.isPending)
    return (
      <div
        role="status"
        aria-label="Carregando condições de saque"
        className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-white/10"
      />
    );
  if (query.isError)
    return (
      <div role="alert">
        Falha ao carregar condições de saque.{' '}
        <button
          type="button"
          className="cursor-pointer rounded border p-2"
          onClick={() => void query.refetch()}
        >
          Tentar novamente
        </button>
      </div>
    );
  const values = query.data.data[tag] ?? {};
  return (
    <section className={panel}>
      <h2 className="mb-4 font-semibold">Saque</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ['SAQUE_MIN', 'Saque mínimo'],
          ['TAXA_SAQUE_FIXA', 'Taxa fixa de saque'],
        ].map(([key, label]) => (
          <FinancialNumberField
            key={key}
            name={key}
            label={label}
            value={draft[key] ?? Math.round((values[key] ?? 0) * 100)}
            onChange={(value) =>
              setDraft((previous) => ({ ...previous, [key]: value }))
            }
            onValidityChange={(name, valid) =>
              setInvalid((previous) => ({ ...previous, [name]: !valid }))
            }
          />
        ))}
      </div>
      <button
        type="button"
        className="mt-4 cursor-pointer rounded border px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={
          !Object.keys(draft).length ||
          Object.values(invalid).some(Boolean) ||
          save.isPending
        }
        onClick={() => save.mutate()}
      >
        Salvar saque
      </button>
    </section>
  );
}
