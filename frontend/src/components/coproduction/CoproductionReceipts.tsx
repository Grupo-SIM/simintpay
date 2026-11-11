'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { ReportDataTable } from '@/app/(dashboard)/relatorio/components/ReportDataTable';
import { ReportPagination } from '@/app/(dashboard)/relatorio/components/ReportPagination';
import { ReportSkeleton } from '@/app/(dashboard)/relatorio/components/ReportSkeleton';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type { CoproductionReceipts as Receipts } from '@/features/coproduction/types';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const states = {
  AVAILABLE: 'Creditado',
  LOCKED: 'Em mediação',
  REVERSED: 'Estornado',
};
const products = {
  plataformas: 'Plataforma',
  'links-pagamento': 'Link de pagamento',
  'links-assinatura': 'Link de assinatura',
  boletos: 'Boleto',
  planos: 'Plano',
  'planos-pix': 'Plano PIX',
  ofertas: 'Oferta',
};

export function CoproductionReceipts({
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
    queryKey: ['coproduction-receipts', user?.id, page, filters],
    queryFn: () =>
      api.get<Receipts>(endpoints.coproduction.receipts, {
        query: { ...filters, page },
        cache: 'no-store',
      }),
    enabled: Boolean(user?.id && !user.isAdmin),
    retry: false,
  });
  if (!user || user.isAdmin) return null;
  return (
    <div
      role="region"
      className="flex flex-col gap-8"
      aria-label="Recebimentos de coprodução"
    >
      {query.isPending ? (
        <ReportSkeleton />
      ) : query.isError ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Não foi possível carregar seus recebimentos. {query.error.message}
          </p>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => void query.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : query.data ? (
        <>
          <ReportDataTable
            title="Recebimentos de coprodução"
            columns={[
              { label: 'Data' },
              { label: 'Produto' },
              { label: 'Status' },
              { label: 'Valor', numeric: true },
            ]}
            summary={`${query.data.total.toLocaleString('pt-BR')} ${query.data.total === 1 ? 'recebimento' : 'recebimentos'}`}
            empty={query.data.data.length === 0}
            emptyMessage="Nenhum recebimento de coprodução no período."
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
                  {products[row.product] ?? 'Produto'}
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
      ) : null}
    </div>
  );
}
