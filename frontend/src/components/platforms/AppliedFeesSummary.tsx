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
import { money, panel } from './types';

const GROUPS: { title: string; keys: PlataformaTaxaKey[] }[] = [
  { title: 'Crédito', keys: ['TAXA_LINK_PERCENT', 'TAXA_LINK_FIXA'] },
  { title: 'Débito', keys: ['TAXA_DEBITO_PERCENT', 'TAXA_DEBITO_FIXA'] },
  { title: 'PIX', keys: ['LIQUIDEZ', 'TAXA_SERVICO'] },
  { title: 'Assinatura', keys: ['TAXA_ASSINATURA'] },
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

export function AppliedFeesSummary() {
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
      <p role="alert" className={panel}>
        Não foi possível carregar as taxas aplicadas.
      </p>
    );
  return (
    <section aria-label="Taxas aplicadas" className={panel}>
      <h2 className="mb-3 font-semibold">Taxas aplicadas</h2>
      <div
        className={`grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 ${query.isPending ? 'animate-pulse opacity-60' : ''}`}
      >
        {GROUPS.map((group) => (
          <dl key={group.title} className="space-y-1 text-sm">
            <dt className="font-medium text-zinc-900 dark:text-zinc-100">
              {group.title}
            </dt>
            {group.keys.map((key) => (
              <dd key={key} className="flex justify-between gap-3">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {PLATAFORMA_TAXA_LABELS[key]}
                </span>
                <span className="font-mono">
                  {format(key, query.data?.data[key])}
                </span>
              </dd>
            ))}
          </dl>
        ))}
      </div>
    </section>
  );
}
