'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { useToast } from '@/components/ui/Toast';
import { FinancialNumberField } from './FinancialNumberField';
import { panel } from './types';

const path = '/admin/plataformas/taxas/GLOBAL';

/** Configuração manual e global do cashback DOM: custo fixo por transação online, ou desativado. */
export function CashbackDomSection() {
  const api = useClienteApi(),
    client = useQueryClient(),
    { toast } = useToast();
  const [active, setActive] = useState<boolean | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [grant, setGrant] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const settings = useQuery({
    queryKey: ['cashback-dom-settings'],
    queryFn: () =>
      api.get<{ data: Record<string, Record<string, number>> }>(path),
  });
  const save = useMutation({
    mutationFn: () =>
      api.patch(path, {
        ...(active !== null && { CASHBACK_DOM_ATIVO: active ? 1 : 0 }),
        ...(cost !== null && { CASHBACK_DOM_CUSTO: cost / 100 }),
        ...(grant !== null && { CASHBACK_DOM_VALOR: grant / 100 }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['cashback-dom-settings'] });
      setActive(null);
      setCost(null);
      setGrant(null);
      toast({ type: 'success', title: 'Cashback DOM salvo' });
    },
    onError: (error: Error) =>
      toast({
        type: 'error',
        title: 'Falha ao salvar cashback DOM',
        description: error.message,
      }),
  });
  if (settings.isPending)
    return (
      <div
        role="status"
        aria-label="Carregando cashback DOM"
        className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-white/10"
      />
    );
  if (settings.isError)
    return (
      <div role="alert">
        Falha ao carregar cashback DOM.{' '}
        <button
          type="button"
          className="cursor-pointer rounded border p-2"
          onClick={() => void settings.refetch()}
        >
          Tentar novamente
        </button>
      </div>
    );
  const values = settings.data.data.GLOBAL ?? {};
  const enabled = active ?? (values.CASHBACK_DOM_ATIVO ?? 1) !== 0;
  return (
    <section className={panel}>
      <h2 className="mb-4 font-semibold">Cashback DOM</h2>
      <div className="mb-4 flex items-center justify-between gap-3 rounded border p-3 text-sm">
        <div>
          <p className="font-medium">Cashback ativo</p>
          <p className="opacity-70">
            Ativo, entra como custo fixo DOM nas transações online. Desativado,
            o cashback é desligado em cada transação enviada à DOM e deixa de
            ser cobrado.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Cashback DOM ativo"
          className="cursor-pointer rounded border px-4 py-2"
          onClick={() => setActive(!enabled)}
        >
          {enabled ? 'Ativo' : 'Desativado'}
        </button>
      </div>
      {enabled && (
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <FinancialNumberField
            name="CASHBACK_DOM_CUSTO"
            label="Custo fixo do cashback DOM"
            value={cost ?? Math.round((values.CASHBACK_DOM_CUSTO ?? 0) * 100)}
            onChange={setCost}
            onValidityChange={(_, valid) => setInvalid(!valid)}
          />
          <FinancialNumberField
            name="CASHBACK_DOM_VALOR"
            label="Bônus ao comprador em outras adquirentes"
            value={grant ?? Math.round((values.CASHBACK_DOM_VALOR ?? 0) * 100)}
            onChange={setGrant}
            onValidityChange={(_, valid) => setInvalid(!valid)}
          />
        </div>
      )}
      <button
        type="button"
        className="mt-4 cursor-pointer rounded border px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={
          (active === null && cost === null && grant === null) ||
          invalid ||
          save.isPending
        }
        onClick={() => save.mutate()}
      >
        Salvar cashback
      </button>
    </section>
  );
}
