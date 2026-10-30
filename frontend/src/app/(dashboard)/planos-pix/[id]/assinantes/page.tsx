'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pause, Play, Search } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useToast } from '@/components/ui/Toast';
import { Input } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { DateRangePickerField } from '@/app/(dashboard)/relatorio/components/DateRangePickerField';
import type { DateRange } from '@/app/(dashboard)/relatorio/types';

type AccessRow = {
  id: string;
  customerName: string | null;
  customerEmail: string;
  customerDocument: string | null;
  isActive: boolean;
  expiresAt: string;
  remainingDays: number;
  totalDaysCredited: number;
  createdAt: string;
};

type ConfirmState = { id: string; email: string; isActive: boolean } | null;

function StatusPill({
  isActive,
  remainingDays,
}: {
  isActive: boolean;
  remainingDays: number;
}) {
  if (!isActive) {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
        Pausado
      </span>
    );
  }
  if (remainingDays <= 3) {
    return (
      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
        Expirando ({remainingDays}d)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
      Ativo
    </span>
  );
}

export default function AssinantesPlanoPix() {
  const { id: planId } = useParams<{ id: string }>();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'true' | 'false'>(
    'all',
  );
  const [dateRange, setDateRange] = useState<DateRange>({
    start: null,
    end: null,
  });

  const pageSize = 20;

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () =>
          typeof window !== 'undefined'
            ? localStorage.getItem('access_token')
            : null,
      }),
    [],
  );

  const dateFrom = dateRange.start
    ? dateRange.start.toISOString().slice(0, 10)
    : undefined;
  const dateTo = dateRange.end
    ? dateRange.end.toISOString().slice(0, 10)
    : undefined;

  const queryKey = [
    'pix-plan-access',
    planId,
    page,
    pageSize,
    search,
    statusFilter,
    dateFrom,
    dateTo,
  ];

  const { data, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      api.get<{
        planAccess: {
          id: string;
          customerName?: string | null;
          customerEmail?: string | null;
          customerDocument?: string | null;
          customer?: {
            name?: string | null;
            email?: string | null;
            document?: string | null;
          };
          isActive: boolean;
          expiresAt?: string | null;
          remainingDays?: number;
          totalDaysCredited?: number;
          createdAt?: string | null;
        }[];
        meta: { currentPage: number; totalPages: number; totalItems: number };
      }>(endpoints.planosPix.accessList, {
        query: {
          pixPlanId: planId,
          page,
          limit: pageSize,
          ...(search.trim() && { search: search.trim() }),
          ...(statusFilter !== 'all' && { isActive: statusFilter }),
          ...(dateFrom && { dateFrom }),
          ...(dateTo && { dateTo }),
        },
      }),
    staleTime: 30_000,
  });

  const rows: AccessRow[] = useMemo(
    () =>
      (data?.planAccess ?? []).map((a) => ({
        id: a.id,
        customerName: a.customerName ?? a.customer?.name ?? null,
        customerEmail: a.customerEmail ?? a.customer?.email ?? '—',
        customerDocument: a.customerDocument ?? a.customer?.document ?? null,
        isActive: Boolean(a.isActive),
        expiresAt: a.expiresAt
          ? new Date(a.expiresAt).toLocaleDateString('pt-BR')
          : '—',
        remainingDays: a.remainingDays ?? 0,
        totalDaysCredited: a.totalDaysCredited ?? 0,
        createdAt: a.createdAt
          ? new Date(a.createdAt).toLocaleDateString('pt-BR')
          : '—',
      })),
    [data],
  );

  const totalPages = data?.meta?.totalPages ?? 1;

  const toggleMutation = useMutation({
    mutationFn: (accessId: string) =>
      api.patch<{
        status: string;
        remainingDaysSuspended?: number;
        daysReturned?: number;
      }>(endpoints.planosPix.accessToggle(accessId), {}),
    onSuccess: (res, accessId) => {
      const wasPausing = rows.find((r) => r.id === accessId)?.isActive ?? true;
      toast({
        type: 'success',
        title: wasPausing ? 'Acesso pausado' : 'Acesso retomado',
        description: wasPausing
          ? `${res.remainingDaysSuspended ?? 0} dias guardados para quando retomar.`
          : `${res.daysReturned ?? 0} dias devolvidos ao assinante.`,
      });
      void queryClient.invalidateQueries({
        queryKey: ['pix-plan-access', planId],
      });
      setConfirm(null);
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível alterar o acesso.',
      });
      setConfirm(null);
    },
  });

  function handleSearchChange(v: string) {
    setSearch(v);
    setPage(1);
  }
  function handleStatusChange(v: string) {
    setStatusFilter(v as 'all' | 'true' | 'false');
    setPage(1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/planos-pix')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/15"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold">Assinantes do plano PIX</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Pausar preserva os dias restantes — ao retomar, os dias são
            devolvidos.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            theme={fieldTheme}
            variant="navbar"
            label="Pesquisar"
            placeholder="Nome, CPF/CNPJ ou e-mail"
            value={search}
            onChange={handleSearchChange}
          />
          <Dropdown
            theme={fieldTheme}
            variant="navbar"
            label="Status"
            value={statusFilter}
            onChange={handleStatusChange}
            options={[
              { label: 'Todos', value: 'all' },
              { label: 'Ativo', value: 'true' },
              { label: 'Pausado', value: 'false' },
            ]}
          />
          <div className="lg:col-span-2">
            <DateRangePickerField
              label="Período"
              theme={fieldTheme}
              value={dateRange}
              onChange={(next) => {
                setDateRange(next);
                setPage(1);
              }}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/40 bg-zinc-50/50 shadow-[0_12px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div className="flex-1 overflow-auto">
          {isFetching && rows.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-zinc-400">
              Carregando…
            </div>
          ) : (
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-white/40 bg-zinc-50/80 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950/80">
                  {[
                    'Assinante',
                    'Documento',
                    'Status',
                    'Dias restantes',
                    'Crédito total',
                    'Expira em',
                    'Desde',
                    'Ações',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/40 dark:divide-white/10">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="transition-colors hover:bg-zinc-950/5 dark:hover:bg-white/5"
                  >
                    <td className="px-4 py-3">
                      {row.customerName ? (
                        <div>
                          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                            {row.customerName}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            {row.customerEmail}
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">
                          {row.customerEmail}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {row.customerDocument ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        isActive={row.isActive}
                        remainingDays={row.remainingDays}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.isActive ? (
                        `${row.remainingDays}d`
                      ) : (
                        <span className="text-zinc-400">— (pausado)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.totalDaysCredited}d
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.expiresAt}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.createdAt}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          setConfirm({
                            id: row.id,
                            email: row.customerEmail,
                            isActive: row.isActive,
                          })
                        }
                        className={[
                          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                          row.isActive
                            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20',
                        ].join(' ')}
                      >
                        {row.isActive ? (
                          <>
                            <Pause className="h-3 w-3" /> Pausar
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3" /> Retomar
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !isFetching && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-10 text-center text-sm text-zinc-400"
                    >
                      Nenhum assinante encontrado para este plano.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3 border-t border-white/40 bg-zinc-50/50 px-6 py-4 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Página{' '}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {page}
            </span>{' '}
            de{' '}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {totalPages}
            </span>
            {data?.meta?.totalItems != null && (
              <>
                {' '}
                &mdash; {data.meta.totalItems} assinante
                {data.meta.totalItems !== 1 ? 's' : ''}
              </>
            )}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={[
                'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all',
                page > 1
                  ? 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                  : 'cursor-not-allowed border-zinc-100 text-zinc-300 dark:border-white/5 dark:text-zinc-600',
              ].join(' ')}
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className={[
                'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all',
                page < totalPages
                  ? 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                  : 'cursor-not-allowed border-zinc-100 text-zinc-300 dark:border-white/5 dark:text-zinc-600',
              ].join(' ')}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !toggleMutation.isPending && setConfirm(null)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {confirm.isActive ? 'Pausar acesso' : 'Retomar acesso'}
            </h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {confirm.isActive
                ? `Pausar o acesso de "${confirm.email}"? Os dias restantes serão guardados e devolvidos ao retomar.`
                : `Retomar o acesso de "${confirm.email}"? Os dias guardados serão devolvidos e a contagem recomeça.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={toggleMutation.isPending}
                onClick={() => setConfirm(null)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={toggleMutation.isPending}
                onClick={() => toggleMutation.mutate(confirm.id)}
                className={[
                  'rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
                  confirm.isActive
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-emerald-600 hover:bg-emerald-700',
                ].join(' ')}
              >
                {toggleMutation.isPending
                  ? 'Aguarde…'
                  : confirm.isActive
                    ? 'Pausar'
                    : 'Retomar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
