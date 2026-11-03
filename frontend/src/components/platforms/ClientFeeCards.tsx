'use client';

import { useQuery } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { endpoints } from '@/services/api/endpoints';
import {
  PLATAFORMA_TAXA_FIXED_BRL,
  PLATAFORMA_TAXA_LABELS,
  taxaToDisplay,
  type PlataformaTaxaKey,
} from '@/features/platform-taxas/taxa-fields';
import { money } from './types';

// Crédito, débito e PIX já aparecem nos cartões de modalidade; faltavam estes.
const GROUPS: { title: string; keys: PlataformaTaxaKey[] }[] = [
  { title: 'Link de assinatura', keys: ['TAXA_ASSINATURA'] },
  {
    title: 'Saque',
    keys: ['TAXA_SAQUE_EXTRA', 'TAXA_SAQUE_PERCENT', 'SAQUE_MIN'],
  },
];

function format(key: PlataformaTaxaKey, value?: number) {
  if (value == null || Number.isNaN(value)) return '—';
  if (PLATAFORMA_TAXA_FIXED_BRL.has(key)) return money(value);
  // TAXA_ASSINATURA já é armazenada como percentual inteiro (9 = 9%).
  if (key === 'TAXA_ASSINATURA') return `${parseFloat(value.toPrecision(10))}%`;
  return `${taxaToDisplay(key, value)}%`;
}

export function ClientFeeCards() {
  const api = useClienteApi();
  const query = useQuery({
    queryKey: ['minhas-taxas'],
    queryFn: () =>
      api.get<{ data: Partial<Record<PlataformaTaxaKey, number>> }>(
        endpoints.admin.plataformas.minhasTaxas,
      ),
  });
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-red-600">
        Não foi possível carregar as taxas de assinatura e saque.
      </p>
    );
  return (
    <section
      aria-label="Assinatura e saque"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {GROUPS.map((group) => (
        <article
          key={group.title}
          aria-label={group.title}
          aria-busy={query.isPending}
          className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02]"
        >
          <h3 className="mb-3 text-sm font-semibold">{group.title}</h3>
          <dl className="divide-y divide-zinc-200 text-xs dark:divide-white/10">
            {group.keys.map((key) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-3 py-1"
              >
                <dt className="text-zinc-500 dark:text-zinc-400">
                  {PLATAFORMA_TAXA_LABELS[key]}
                </dt>
                <dd className="m-0 shrink-0 tabular-nums">
                  {query.isPending ? (
                    <span
                      aria-label="Calculando"
                      className="inline-block h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-white/10"
                    />
                  ) : (
                    format(key, query.data?.data[key])
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </section>
  );
}
