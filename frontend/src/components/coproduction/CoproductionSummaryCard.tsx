'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type { CoproductionReceipts } from '@/features/coproduction/types';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Participações em produtos de terceiros, separadas da receita de vendas próprias. */
export function CoproductionSummaryCard({
  filters = {},
}: {
  filters?: Record<string, string | undefined>;
} = {}) {
  const { user } = useCurrentUser();
  const query = useQuery({
    queryKey: ['coproduction-receipts', user?.id, 1, filters],
    queryFn: () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token'),
      }).get<CoproductionReceipts>(endpoints.coproduction.receipts, {
        query: { ...filters, page: 1 },
        cache: 'no-store',
      }),
    enabled: Boolean(user?.id && !user.isAdmin),
    retry: false,
  });
  if (!query.data || query.data.total === 0) return null;
  const { summary } = query.data;
  return (
    <section
      aria-label="Coprodução"
      className="rounded-xl border border-zinc-200 p-4 dark:border-white/10"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Coprodução</h2>
        <Link
          href="/relatorio"
          className="text-sm text-violet-700 hover:underline dark:text-violet-300"
        >
          Ver recebimentos
        </Link>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['Creditado', summary.creditedCents],
            ['Em mediação', summary.lockedCents],
            ['Estornado', summary.reversedCents],
          ] as const
        ).map(([label, cents]) => (
          <div
            key={label}
            className="rounded-lg border border-zinc-200 p-3 dark:border-white/10"
          >
            <dt className="text-sm text-zinc-500 dark:text-zinc-400">
              {label}
            </dt>
            <dd className="text-lg font-semibold">{money(cents)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Participações em produtos de outros proprietários, somente leitura.
        Créditos já integram sua carteira.
      </p>
    </section>
  );
}
