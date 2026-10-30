'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Receipt,
  XCircle,
} from 'lucide-react';
import { useMemo } from 'react';
import { Spinner } from '@/components/ui/Loading';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';

function makeApi() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}

function formatBRL(v: number) {
  return (v ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

const CHECKOUT_BASE_URL = process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL;
/** paymentRef = id do PaymentLink gerado automaticamente pela cobrança. */
function checkoutUrlFor(paymentRef: string) {
  return `${CHECKOUT_BASE_URL}/?simLinkCode=${encodeURIComponent(paymentRef)}`;
}

type MinhaCobranca = {
  id: string;
  amount: number;
  description: string | null;
  status: string;
  vencida?: boolean;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  paymentRef?: string | null;
};

export default function MinhasCobrancasPage() {
  const api = useMemo(() => makeApi(), []);

  const { data, isLoading } = useQuery({
    queryKey: ['minhas-cobrancas'],
    staleTime: 30_000,
    queryFn: () =>
      api.get<{ data: MinhaCobranca[] }>(endpoints.admin.cobrancas.minhas),
  });

  const cobrancas = data?.data ?? [];
  const pendentes = cobrancas.filter((c) => c.status === 'PENDING');
  const totalPendente = pendentes.reduce((acc, c) => acc + c.amount, 0);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-3 pb-10 pt-2 sm:px-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-3xl">
          <Receipt className="h-7 w-7 text-violet-500" /> Cobranças
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Cobranças geradas para a sua conta.
        </p>
      </div>

      {pendentes.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Você tem <span className="font-bold">{pendentes.length}</span>{' '}
            cobrança(s) pendente(s), totalizando{' '}
            <span className="font-bold">{formatBRL(totalPendente)}</span>.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-white/5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-white/10 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Pagamento</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="py-10 text-center">
                  <Spinner className="mx-auto h-6 w-6 text-violet-500" />
                </td>
              </tr>
            ) : cobrancas.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="py-12 text-center text-sm text-zinc-400"
                >
                  Você não tem cobranças.
                </td>
              </tr>
            ) : (
              cobrancas.map((c) => {
                const pago = c.status === 'PAID';
                const cancelado = c.status === 'CANCELED';
                return (
                  <tr
                    key={c.id}
                    className="border-b border-zinc-50 last:border-0 dark:border-white/5"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {c.description || 'Cobrança'}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {new Date(c.createdAt).toLocaleDateString('pt-BR')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                      {c.dueDate
                        ? new Date(c.dueDate).toLocaleDateString('pt-BR')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                      {formatBRL(c.amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {pago ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Paga
                        </span>
                      ) : cancelado ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
                          <XCircle className="h-3.5 w-3.5" /> Cancelada
                        </span>
                      ) : c.vencida ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                          <Clock className="h-3.5 w-3.5" /> Vencida
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          <Clock className="h-3.5 w-3.5" /> Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {!pago && !cancelado && c.paymentRef ? (
                        <a
                          href={checkoutUrlFor(c.paymentRef)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Pagar agora
                        </a>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
