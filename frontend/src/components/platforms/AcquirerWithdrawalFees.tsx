'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { useToast } from '@/components/ui/Toast';
import { FinancialNumberField } from './FinancialNumberField';
import { panel } from './types';

type WithdrawalFee = {
  code: string;
  name: string;
  active: boolean;
  feeCents: number | null;
};

const path = '/platforms/acquirers/fees/withdrawal';

/** Cost per withdrawal for each acquirer; the charged fee is the highest active one plus the extra. */
export function AcquirerWithdrawalFees() {
  const api = useClienteApi(),
    client = useQueryClient(),
    { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const query = useQuery({
    queryKey: ['acquirer-withdrawal-fees'],
    queryFn: () => api.get<{ data: WithdrawalFee[] }>(path),
  });
  const save = useMutation({
    mutationFn: () =>
      Promise.all(
        Object.entries(draft).map(([code, feeCents]) =>
          api.post(`${path}/${encodeURIComponent(code)}`, { feeCents }),
        ),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['acquirer-withdrawal-fees'],
      });
      setDraft({});
      toast({ type: 'success', title: 'Taxas de saque salvas' });
    },
    onError: () =>
      toast({ type: 'error', title: 'Falha ao salvar taxas de saque' }),
  });
  if (query.isPending)
    return (
      <div
        role="status"
        aria-label="Carregando taxas de saque"
        className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-white/10"
      />
    );
  if (query.isError)
    return (
      <div role="alert">
        Falha ao carregar taxas de saque.{' '}
        <button
          type="button"
          className="cursor-pointer rounded border p-2"
          onClick={() => void query.refetch()}
        >
          Tentar novamente
        </button>
      </div>
    );
  return (
    <section className={panel}>
      <h2 className="mb-1 font-semibold">Taxa de saque por adquirente</h2>
      <p className="mb-4 text-sm opacity-70">
        A taxa cobrada no saque é a maior entre as adquirentes ativas somada ao
        extra definido em Saque.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {query.data.data.map((acquirer) => (
          <FinancialNumberField
            key={acquirer.code}
            name={acquirer.code}
            label={`${acquirer.name}${acquirer.active ? '' : ' (inativa)'}`}
            value={draft[acquirer.code] ?? acquirer.feeCents ?? 0}
            onChange={(value) =>
              setDraft((previous) => ({ ...previous, [acquirer.code]: value }))
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
        Salvar taxas de saque
      </button>
    </section>
  );
}
