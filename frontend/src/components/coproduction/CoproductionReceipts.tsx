'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { ScrollArea } from '@/components/ui/ScrollArea';
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
};

export function CoproductionReceipts() {
  const { user } = useCurrentUser();
  const [page, setPage] = useState(1);
  const api = createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
  const query = useQuery({
    queryKey: ['coproduction-receipts', user?.id, page],
    queryFn: () =>
      api.get<Receipts>(endpoints.coproduction.receipts, {
        query: { page },
        cache: 'no-store',
      }),
    enabled: Boolean(user?.id && !user.isAdmin),
    retry: false,
  });
  if (!user || user.isAdmin) return null;
  return (
    <section
      className="space-y-4 rounded-xl border border-zinc-200 p-5 dark:border-white/10"
      aria-label="Recebimentos de coprodução"
    >
      <div>
        <h2 className="text-lg font-semibold">Recebimentos de coprodução</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Histórico completo das suas participações em produtos de outros
          proprietários. Créditos integram sua carteira; totais abaixo não
          representam saldo disponível para saque.
        </p>
      </div>
      {query.isPending ? (
        <div
          role="status"
          aria-label="Carregando recebimentos"
          className="animate-pulse space-y-3"
        >
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((key) => (
              <div
                key={key}
                className="h-20 rounded-lg bg-zinc-200 dark:bg-white/10"
              />
            ))}
          </div>
          <div className="h-40 rounded-lg bg-zinc-200 dark:bg-white/10" />
        </div>
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
          <dl className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['Creditado', query.data.summary.creditedCents],
                ['Em mediação', query.data.summary.lockedCents],
                ['Estornado', query.data.summary.reversedCents],
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
          <ScrollArea className="max-h-80">
            {query.data.data.length ? (
              <ul className="space-y-2">
                {query.data.data.map((row) => (
                  <li
                    key={row.transactionId}
                    className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 p-3 dark:border-white/10"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {products[row.product] ?? 'Produto'}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {new Date(row.createdAt).toLocaleString('pt-BR')} ·{' '}
                        {states[row.state] ?? 'Indisponível'}
                      </p>
                    </div>
                    <strong className="shrink-0 text-sm">
                      {money(row.amountCents)}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-5 text-sm text-zinc-500 dark:text-zinc-400">
                Nenhum recebimento de coprodução registrado.
              </p>
            )}
          </ScrollArea>
          {query.data.total > query.data.pageSize && (
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="outline"
                className="cursor-pointer disabled:cursor-not-allowed"
                disabled={page === 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Anterior
              </Button>
              <span className="text-sm">Página {page}</span>
              <Button
                variant="outline"
                className="cursor-pointer disabled:cursor-not-allowed"
                disabled={page * query.data.pageSize >= query.data.total}
                onClick={() => setPage((value) => value + 1)}
              >
                Próxima
              </Button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
