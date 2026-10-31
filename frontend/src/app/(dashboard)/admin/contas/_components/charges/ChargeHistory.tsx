'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { ChargeDateField } from './ChargeDateField';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { endpoints } from '@/services/api/endpoints';
import { chargesApi, checkoutUrl, money } from './api';
import type { ChargeClient } from './types';

type Charge = {
  id: string;
  email: string;
  amount: number;
  description: string | null;
  mode: string;
  status: string;
  vencida?: boolean;
  dueDate: string | null;
  createdAt: string;
  paymentRef?: string | null;
  saldoDepois: number | null;
};
type History = { data: Charge[]; totalPages: number };
const actionClass =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 bg-white/70 px-3 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10';

export function ChargeHistory({ client }: { client: ChargeClient }) {
  const { resolvedTheme } = useTheme();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const { toast } = useToast();
  const cache = useQueryClient();
  const history = useQuery({
    queryKey: ['cobrancas', 'historico', client.id, page, status, start, end],
    queryFn: () =>
      chargesApi().get<History>(endpoints.admin.cobrancas.historico, {
        query: {
          search: client.email,
          page,
          pageSize: 20,
          status: status || undefined,
          dataInicio: start || undefined,
          dataFim: end || undefined,
        },
      }),
  });
  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'PAID' | 'CANCELED' }) =>
      chargesApi().post(endpoints.admin.cobrancas.status(id), { status }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['cobrancas'] });
      toast({ type: 'success', title: 'Cobrança atualizada' });
    },
    onError: (error) =>
      toast({
        type: 'error',
        title: 'Erro ao atualizar',
        description: error.message,
      }),
  });
  const rows = (history.data?.data ?? []).filter(
    (charge) => charge.email.toLowerCase() === client.email.toLowerCase(),
  );
  return (
    <div className="space-y-4">
      <div className="grid items-end gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03] sm:grid-cols-3">
        <Dropdown
          label="Status"
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          variant="navbar"
          portal
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'Todos' },
            { value: 'PENDING', label: 'Pendente' },
            { value: 'VENCIDA', label: 'Vencida' },
            { value: 'PAID', label: 'Paga' },
            { value: 'CANCELED', label: 'Cancelada' },
            { value: 'APPLIED', label: 'Aplicada (débito)' },
          ]}
        />
        <ChargeDateField
          label="Data inicial"
          value={start}
          onChange={(value) => {
            setStart(value);
            setPage(1);
          }}
        />
        <ChargeDateField
          label="Data final"
          value={end}
          onChange={(value) => {
            setEnd(value);
            setPage(1);
          }}
        />
      </div>
      <div
        className="custom-scrollbar max-h-[38vh] overflow-auto rounded-xl border border-zinc-200 dark:border-white/10"
        aria-label="Histórico de cobranças"
        tabIndex={0}
      >
        <table className="w-full text-left text-sm text-zinc-700 dark:text-zinc-300">
          <thead className="sticky top-0 bg-zinc-50 text-xs font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              {[
                'Data / vencimento',
                'Descrição',
                'Valor',
                'Modo / status',
                'Ações',
              ].map((label) => (
                <th key={label} className="px-4 py-3 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.isPending ? (
              Array.from({ length: 5 }, (_, index) => (
                <tr key={index}>
                  {Array.from({ length: 5 }, (_, cell) => (
                    <td key={cell} className="p-3">
                      <div className="h-8 animate-pulse rounded bg-zinc-200 dark:bg-white/10" />
                    </td>
                  ))}
                </tr>
              ))
            ) : history.isError ? (
              <tr>
                <td colSpan={5} className="p-6 text-center">
                  <p>Não foi possível carregar cobranças.</p>
                  <button
                    type="button"
                    onClick={() => void history.refetch()}
                    className={`${actionClass} mt-2`}
                  >
                    Tentar novamente
                  </button>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-14 text-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  Nenhuma cobrança encontrada.
                </td>
              </tr>
            ) : (
              rows.map((charge) => {
                const url = charge.paymentRef
                  ? checkoutUrl(charge.paymentRef)
                  : null;
                const pending =
                  charge.mode === 'PAYABLE' && charge.status === 'PENDING';
                const label =
                  charge.mode === 'DEBIT'
                    ? 'Aplicada'
                    : charge.status === 'PAID'
                      ? 'Paga'
                      : charge.status === 'CANCELED'
                        ? 'Cancelada'
                        : charge.vencida
                          ? 'Vencida'
                          : 'Pendente';
                return (
                  <tr
                    key={charge.id}
                    className="border-t border-zinc-200 dark:border-white/10"
                  >
                    <td className="whitespace-nowrap p-3 text-xs">
                      {new Date(charge.createdAt).toLocaleString('pt-BR')}
                      {charge.dueDate && (
                        <div>
                          Vence:{' '}
                          {new Date(charge.dueDate).toLocaleDateString('pt-BR')}
                        </div>
                      )}
                    </td>
                    <td className="p-3">{charge.description || 'Cobrança'}</td>
                    <td className="whitespace-nowrap p-3 font-semibold">
                      {money(charge.amount)}
                      {charge.saldoDepois !== null && (
                        <div className="text-xs font-normal text-zinc-500">
                          Saldo: {money(charge.saldoDepois)}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <div>
                        {charge.mode === 'DEBIT' ? 'Débito' : 'A pagar'}
                      </div>
                      <span
                        className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${charge.mode === 'DEBIT' ? 'border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-300' : charge.status === 'PAID' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : charge.status === 'CANCELED' ? 'border-zinc-500/20 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400' : charge.vencida ? 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300'}`}
                      >
                        {label}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {url && (
                          <>
                            <button
                              type="button"
                              className={actionClass}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(url);
                                  toast({
                                    type: 'success',
                                    title: 'Link copiado',
                                  });
                                } catch {
                                  toast({
                                    type: 'error',
                                    title: 'Não foi possível copiar o link',
                                  });
                                }
                              }}
                            >
                              <Copy size={13} /> Link
                            </button>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={actionClass}
                            >
                              <ExternalLink size={13} /> Checkout
                            </a>
                          </>
                        )}
                        {pending && (
                          <>
                            <button
                              type="button"
                              disabled={mutation.isPending}
                              className={actionClass}
                              onClick={() =>
                                mutation.mutate({
                                  id: charge.id,
                                  status: 'PAID',
                                })
                              }
                            >
                              <Check size={13} /> Marcar paga
                            </button>
                            <ConfirmActionButton
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={mutation.isPending}
                              className={actionClass}
                              label="Cancelar cobrança"
                              confirmation="Cancelar esta cobrança definitivamente?"
                              confirmContent={
                                <>
                                  <X size={13} /> Confirmar
                                </>
                              }
                              onConfirm={() =>
                                mutation.mutate({
                                  id: charge.id,
                                  status: 'CANCELED',
                                })
                              }
                            >
                              <X size={13} /> Cancelar
                            </ConfirmActionButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-3 text-sm text-zinc-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400">
        <span>
          Página {page} de {history.data?.totalPages || 1}
        </span>
        <div className="flex gap-2">
          <ActionButton
            type="button"
            className="h-8 cursor-pointer px-3 text-xs"
            disabled={page <= 1 || history.isFetching}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </ActionButton>
          <ActionButton
            type="button"
            className="h-8 cursor-pointer px-3 text-xs"
            disabled={
              page >= (history.data?.totalPages || 1) || history.isFetching
            }
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
