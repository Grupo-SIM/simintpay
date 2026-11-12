'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { FinancialConfiguration } from './financial-types';
import { panel } from './types';

type Settings = {
  data: Record<string, Record<string, number>>;
  meta?: { sources?: Record<string, Record<string, string>> };
};

/**
 * Platform/user scope: inherit the global settings or customize. Customized = any stored override (taxa
 * keys, lane contracts, target fee). Switching back to global asks for confirmation and clears them all.
 */
export function TaxaScopeToggle({
  tag,
  children,
}: {
  tag: string;
  children: ReactNode;
}) {
  const api = useClienteApi(),
    client = useQueryClient(),
    { toast } = useToast();
  const [mode, setMode] = useState<'global' | 'custom' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const taxaPath = `/admin/plataformas/taxas/${encodeURIComponent(tag)}`;
  const policyPath = `/platforms/${encodeURIComponent(tag)}/financial-policy`;
  const settings = useQuery({
    queryKey: ['taxa-scope-settings', tag],
    gcTime: 0,
    queryFn: () => api.get<Settings>(taxaPath),
  });
  const policy = useQuery({
    queryKey: ['taxa-scope-policy', tag],
    gcTime: 0,
    queryFn: () => api.get<{ data: FinancialConfiguration }>(policyPath),
  });
  const reset = useMutation({
    mutationFn: async () => {
      const canonical = tag.toUpperCase();
      const keys = Object.keys(settings.data?.data[canonical] ?? {});
      const current = await api.get<{ data: FinancialConfiguration }>(
        policyPath,
      );
      if (keys.length)
        await api.patch(
          taxaPath,
          Object.fromEntries(keys.map((key) => [key, null])),
        );
      await api.patch(policyPath, {
        version: current.data.version,
        lanes: {},
        ...(current.data.targetFeePpm != null ? { targetFeePpm: null } : {}),
      });
    },
    onSuccess: async () => {
      setMode('global');
      setConfirming(false);
      await client.invalidateQueries();
      toast({
        type: 'success',
        title: 'Configurações globais aplicadas',
        description: 'Somente novas cobranças usam esta versão.',
      });
    },
    onError: (error: Error) =>
      toast({
        type: 'error',
        title: 'Falha ao aplicar configurações globais',
        description: error.message,
      }),
  });
  if (settings.isPending || policy.isPending)
    return (
      <div
        role="status"
        aria-label="Carregando escopo das taxas"
        className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-white/10"
      />
    );
  if (settings.isError || policy.isError)
    return (
      <div role="alert">
        Falha ao carregar o escopo das taxas.{' '}
        <button
          type="button"
          className="cursor-pointer rounded border p-2"
          onClick={() => {
            void settings.refetch();
            void policy.refetch();
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  const canonical = tag.toUpperCase();
  const sources = settings.data.meta?.sources?.[canonical] ?? {};
  const configuration = policy.data.data;
  const customized =
    Object.values(sources).some((source) => source === 'override') ||
    Object.keys(configuration.laneOverrides ?? {}).length > 0 ||
    configuration.targetFeePpm != null;
  const selected = mode ?? (customized ? 'custom' : 'global');
  const custom = selected === 'custom';
  const choose = (next: 'global' | 'custom') => {
    if (next === selected) return;
    if (next === 'custom') return setMode('custom');
    if (customized) return setConfirming(true);
    setMode('global');
  };
  return (
    <>
      <section className={panel} aria-label="Escopo das taxas">
        <h2 className="mb-1 font-semibold">Configurações</h2>
        <p className="mb-3 text-sm opacity-70">
          {custom
            ? 'Taxas, saque e cashback personalizados para esta conta.'
            : 'Esta conta usa as configurações globais.'}
        </p>
        <div role="radiogroup" aria-label="Escopo" className="flex gap-2">
          {(
            [
              ['global', 'Usar globais'],
              ['custom', 'Personalizar'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected === value}
              disabled={reset.isPending}
              className="cursor-pointer rounded border px-4 py-2 aria-checked:bg-zinc-200 aria-checked:font-semibold disabled:cursor-not-allowed dark:aria-checked:bg-white/15"
              onClick={() => choose(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {confirming && (
          <div role="alert" className="mt-3 rounded border p-3 text-sm">
            <p className="mb-3">
              Isso remove todas as taxas personalizadas desta conta e volta a
              usar as globais. Cobranças já feitas não mudam.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={reset.isPending}
                onClick={() => reset.mutate()}
              >
                Aplicar globais
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={reset.isPending}
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </section>
      {custom && children}
    </>
  );
}
