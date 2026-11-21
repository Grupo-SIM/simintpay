'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { ReportDataTable } from '@/app/(dashboard)/relatorio/components/ReportDataTable';
import { ReportPagination } from '@/app/(dashboard)/relatorio/components/ReportPagination';
import { ReportSkeleton } from '@/app/(dashboard)/relatorio/components/ReportSkeleton';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { affiliateLink } from '@/features/affiliates/affiliates';
import type { AffiliateReceipts as Receipts } from '@/features/affiliates/types';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const states = {
  AVAILABLE: 'Creditada',
  LOCKED: 'Pendente',
  REVERSED: 'Revertida',
};

/** Visão somente leitura do afiliado: código, link, vendas e comissões. */
export function AffiliateReceipts({
  filters = {},
}: {
  filters?: Record<string, string | undefined>;
} = {}) {
  const { user } = useCurrentUser();
  const [page, setPage] = useState(1);
  const api = createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
  const query = useQuery({
    queryKey: ['affiliate-receipts', user?.id, page, filters],
    queryFn: () =>
      api.get<Receipts>(endpoints.affiliates.receipts, {
        query: { ...filters, page },
        cache: 'no-store',
      }),
    enabled: Boolean(user?.id && !user.isAdmin),
    retry: false,
  });
  if (!user || user.isAdmin) return null;
  if (
    query.isSuccess &&
    query.data.total === 0 &&
    !query.data.affiliations?.length
  )
    return null;
  return (
    <div
      role="region"
      className="flex flex-col gap-6"
      aria-label="Recebimentos de afiliado"
    >
      {query.isPending ? (
        <ReportSkeleton />
      ) : query.isError ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Não foi possível carregar suas comissões de afiliado.{' '}
            {query.error.message}
          </p>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => void query.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <section
            aria-label="Afiliado"
            className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-white/10"
          >
            <h2 className="text-base font-semibold">Afiliado</h2>
            {query.data.affiliations?.length ? (
              <ul className="space-y-2 text-sm">
                {query.data.affiliations.map((row) => (
                  <li
                    key={`${row.code}-${row.platformName ?? ''}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    {row.platformName && <span>{row.platformName}:</span>}
                    <span>
                      Código <strong className="font-mono">{row.code}</strong>
                    </span>
                    <CopyButton
                      value={row.code}
                      label="Copiar código"
                      className="px-2 py-1 text-xs"
                    />
                    {row.linkBaseUrl && (
                      <CopyButton
                        value={affiliateLink(row.linkBaseUrl, row.code)}
                        label="Copiar link"
                        className="px-2 py-1 text-xs"
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            <dl className="grid gap-3 sm:grid-cols-4">
              {(
                [
                  ['Vendas', String(query.data.total)],
                  ['Pendente', money(query.data.summary.lockedCents)],
                  ['Creditada', money(query.data.summary.creditedCents)],
                  ['Revertida', money(query.data.summary.reversedCents)],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-zinc-200 p-3 dark:border-white/10"
                >
                  <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                    {label}
                  </dt>
                  <dd className="text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Comissões creditadas já integram sua carteira. Somente leitura.
            </p>
          </section>
          <ReportDataTable
            title="Recebimentos de afiliado"
            columns={[
              { label: 'Data' },
              { label: 'Origem' },
              { label: 'Status' },
              { label: 'Comissão', numeric: true },
            ]}
            summary={`${query.data.total.toLocaleString('pt-BR')} ${query.data.total === 1 ? 'venda' : 'vendas'}`}
            empty={query.data.data.length === 0}
            emptyMessage="Nenhuma comissão de afiliado no período."
            footer={
              query.data.total > query.data.pageSize ? (
                <ReportPagination
                  page={page}
                  total={query.data.total}
                  pageSize={query.data.pageSize}
                  onChange={setPage}
                />
              ) : undefined
            }
          >
            {query.data.data.map((row) => (
              <tr
                key={row.transactionId}
                className="transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.025]"
              >
                <td className="whitespace-nowrap px-5 py-4 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  {new Date(row.createdAt).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-5 py-4 font-medium">
                  {row.originName ?? 'Venda'}
                  {row.isRenewal ? ' (renovação)' : ''}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-xs text-zinc-600 dark:text-zinc-300">
                  {states[row.state] ?? 'Indisponível'}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-right font-semibold tabular-nums">
                  {money(row.amountCents)}
                </td>
              </tr>
            ))}
          </ReportDataTable>
        </>
      )}
    </div>
  );
}
