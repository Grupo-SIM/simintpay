'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { FinancialPolicyDraft } from './FinancialPolicyDraft';
import type { FinancialConfiguration } from './financial-types';
import { panel } from './types';

export function FinancialPolicyEditor({
  tag,
  name,
  admin = false,
}: {
  tag: string;
  name: string;
  admin?: boolean;
}) {
  const api = useClienteApi();
  const [reset, setReset] = useState(0);
  const configuration = useQuery({
    queryKey: ['financial-policy', tag, admin],
    gcTime: 0,
    queryFn: () =>
      api.get<{ data: FinancialConfiguration }>(
        `/platforms/${encodeURIComponent(tag)}/financial-policy`,
      ),
  });
  if (configuration.isPending)
    return (
      <div
        aria-label="Carregando configuração financeira"
        role="status"
        className={`${panel} animate-pulse space-y-4`}
      >
        <div className="h-8 w-2/3 rounded bg-zinc-200 dark:bg-white/10" />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="h-24 rounded bg-zinc-200 dark:bg-white/10" />
        ))}
      </div>
    );
  if (configuration.isError)
    return (
      <div className={panel} role="alert">
        Falha ao carregar configuração.{' '}
        <button
          type="button"
          className="cursor-pointer rounded border p-2"
          onClick={() => void configuration.refetch()}
        >
          Tentar novamente
        </button>
      </div>
    );
  return (
    <section className={panel}>
      <h2 className="mb-4 text-lg font-semibold">
        Taxas, juros e simulação — {name}
      </h2>
      <FinancialPolicyDraft
        key={`${tag}-${configuration.data.data.version}-${reset}`}
        tag={tag}
        configuration={configuration.data.data}
        admin={admin}
        onDiscard={() => {
          setReset((value) => value + 1);
          void configuration.refetch();
        }}
      />
    </section>
  );
}
