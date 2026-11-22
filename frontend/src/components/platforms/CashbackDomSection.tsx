'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { useToast } from '@/components/ui/Toast';
import { FinancialNumberField } from './FinancialNumberField';
import { FormSwitch } from '@/components/ui/FormSwitch';

type Settings = {
  data: Record<string, Record<string, number>>;
  meta?: { sources?: Record<string, Record<string, string>> };
};
type Choice = 'inherit' | 'on' | 'off';

/**
 * Cashback DOM. No padrão global fica a configuração manual (ativo, custo e bônus a compradores de
 * outras adquirentes); plataformas e usuários só decidem se o cashback fica ativo, herdando do global.
 */
export function CashbackDomSection({ tag = 'GLOBAL' }: { tag?: string }) {
  const api = useClienteApi(),
    client = useQueryClient(),
    { toast } = useToast();
  const global = tag === 'GLOBAL';
  const path = `/admin/plataformas/taxas/${encodeURIComponent(tag)}`;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [grant, setGrant] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const settings = useQuery({
    queryKey: ['cashback-dom-settings', tag],
    queryFn: () => api.get<Settings>(path),
  });
  const save = useMutation({
    mutationFn: () =>
      api.patch(path, {
        ...(choice !== null && {
          CASHBACK_DOM_ATIVO:
            choice === 'inherit' ? null : choice === 'on' ? 1 : 0,
        }),
        ...(cost !== null && { CASHBACK_DOM_CUSTO: cost / 100 }),
        ...(grant !== null && { CASHBACK_DOM_VALOR: grant / 100 }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['cashback-dom-settings'] });
      setChoice(null);
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
  const canonical = tag.toUpperCase();
  const values = settings.data.data[canonical] ?? {};
  const globalValues = settings.data.data.GLOBAL ?? values;
  const source = settings.data.meta?.sources?.[canonical]?.CASHBACK_DOM_ATIVO;
  const saved: Choice =
    global || source === 'override'
      ? (values.CASHBACK_DOM_ATIVO ?? 1) !== 0
        ? 'on'
        : 'off'
      : 'inherit';
  const selected = choice ?? saved;
  const enabled =
    selected === 'inherit'
      ? (globalValues.CASHBACK_DOM_ATIVO ?? 1) !== 0
      : selected === 'on';
  const saveButton = (
    <button
      type="button"
      className="cursor-pointer rounded border px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={
        (choice === null && cost === null && grant === null) ||
        invalid ||
        save.isPending
      }
      onClick={() => save.mutate()}
    >
      Salvar
    </button>
  );
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Cashback DOM
        </span>
        <div className="flex items-center gap-3">
          {!global && selected !== 'inherit' && (
            <button
              type="button"
              className="cursor-pointer text-xs underline opacity-70"
              onClick={() => setChoice('inherit')}
            >
              Herdar do global
            </button>
          )}
          {!global && selected === 'inherit' && (
            <span className="text-xs opacity-70">Herdado do global</span>
          )}
          <FormSwitch
            aria-label="Cashback DOM"
            checked={enabled}
            onChange={(on) => setChoice(on ? 'on' : 'off')}
          />
          {!global && saveButton}
        </div>
      </div>
      {global && enabled && (
        <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <FinancialNumberField
            name="CASHBACK_DOM_CUSTO"
            label="Custo fixo"
            value={cost ?? Math.round((values.CASHBACK_DOM_CUSTO ?? 0) * 100)}
            onChange={setCost}
            onValidityChange={(_, valid) => setInvalid(!valid)}
          />
          <FinancialNumberField
            name="CASHBACK_DOM_VALOR"
            label="Bônus em outras adquirentes"
            value={grant ?? Math.round((values.CASHBACK_DOM_VALOR ?? 0) * 100)}
            onChange={setGrant}
            onValidityChange={(_, valid) => setInvalid(!valid)}
          />
        </div>
      )}
      {global && <div className="mt-4">{saveButton}</div>}
    </div>
  );
}
