'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { useToast } from '@/components/ui/Toast';
import {
  AcquirerWithdrawalFeesModal,
  acquirerFeesPath,
  type WithdrawalFee,
} from './AcquirerWithdrawalFeesModal';
import { FinancialNumberField } from './FinancialNumberField';
import { panel } from './types';

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** The charged withdrawal fee is the highest active acquirer fee plus the platform extra. */
export function WithdrawalSection({ tag }: { tag: string }) {
  const api = useClienteApi(),
    client = useQueryClient(),
    { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const path = `/admin/plataformas/taxas/${encodeURIComponent(tag)}`;
  const settings = useQuery({
    queryKey: ['withdrawal-settings', tag],
    queryFn: () =>
      api.get<{ data: Record<string, Record<string, number>> }>(path),
  });
  const fees = useQuery({
    queryKey: ['acquirer-withdrawal-fees'],
    queryFn: () => api.get<{ data: WithdrawalFee[] }>(acquirerFeesPath),
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
  if (settings.isPending || fees.isPending)
    return (
      <div
        role="status"
        aria-label="Carregando condições de saque"
        className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-white/10"
      />
    );
  if (settings.isError || fees.isError)
    return (
      <div role="alert">
        Falha ao carregar condições de saque.{' '}
        <button
          type="button"
          className="cursor-pointer rounded border p-2"
          onClick={() => {
            void settings.refetch();
            void fees.refetch();
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  const values = settings.data.data[tag] ?? {};
  const active = fees.data.data.filter((fee) => fee.active);
  const missing = active.filter((fee) => fee.feeCents === null).length;
  const highest = Math.max(0, ...active.map((fee) => fee.feeCents ?? 0));
  return (
    <section className={panel}>
      <h2 className="mb-4 font-semibold">Saque</h2>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border p-3">
        <div className="text-sm">
          <p className="font-medium">Taxa por adquirente</p>
          <p className="opacity-70">
            Maior taxa entre as ativas: {brl(highest)}
          </p>
          {missing > 0 && (
            <p role="status" className="mt-1 text-amber-500">
              {missing === 1
                ? '1 taxa não configurada'
                : `${missing} taxas não configuradas`}
            </p>
          )}
        </div>
        <button
          type="button"
          className="cursor-pointer rounded border px-4 py-2"
          onClick={() => setModalOpen(true)}
        >
          Configurar taxas
        </button>
      </div>
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        {[
          ['SAQUE_MIN', 'Saque mínimo'],
          ['TAXA_SAQUE_EXTRA', 'Extra sobre a maior taxa de saque'],
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
      <AcquirerWithdrawalFeesModal
        open={modalOpen}
        fees={fees.data.data}
        onClose={() => setModalOpen(false)}
      />
    </section>
  );
}
