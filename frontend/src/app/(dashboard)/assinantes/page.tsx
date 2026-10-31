'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { CalendarX, PauseCircle, Trash2, Check, X } from 'lucide-react';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { getDefaultSubscriberColumnVisibility } from './column-config';
import type { SubscriberFiltersState, SubscriberRow } from './types';
import { SubscribersFilters } from './components/SubscribersFilters';
import { SubscribersTable } from './components/SubscribersTable';
import type { Action as SubscriberAction } from './components/SubscribersRowActionsMenu';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import {
  cancelAssinante,
  listAssinantes,
  pauseAssinante,
  removeAssinanteFromHistory,
  resumeAssinante,
} from '@/features/assinantes/services/assinantes.service';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/use-current-user';
import { isMasterAdminClient } from '@/lib/is-master-admin-client';

type PauseConfirm = { rowId: string; name: string };
type PauseResult = {
  remainingDays: number;
  pausedAt: string;
  warningMessage: string;
  name: string;
};
type ResumeConfirm = {
  rowId: string;
  name: string;
  remainingDays: number | null;
};
type ResumeResult = {
  newExpiresAt: string;
  remainingDays: number;
  name: string;
};
type BulkAction = 'desativar' | 'pausar' | 'excluir';
type BulkConfirm = { action: BulkAction; rows: SubscriberRow[] };

const TABLE_PAGE_SIZE = 20;

function endOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function parseYmdParam(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, day] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toLocalYmd(d: Date) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

const initialFilters = (
  searchParams: URLSearchParams,
): SubscriberFiltersState => ({
  search: searchParams.get('q') ?? '',
  statusGroup: searchParams.get('statusGroup') ?? '',
  frequency: searchParams.get('frequency') ?? '',
  plataforma: searchParams.get('plataforma') ?? '',
  dateRange: {
    start: parseYmdParam(searchParams.get('criadoDe')),
    end: parseYmdParam(searchParams.get('criadoAte')),
  },
});

export default function AssinantesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const isMasterAdmin = isMasterAdminClient(user);

  const [filters, setFilters] = useState<SubscriberFiltersState>(() =>
    initialFilters(searchParams),
  );
  const [currentPage, setCurrentPage] = useState(
    Number(searchParams.get('page') ?? '1'),
  );
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => getDefaultSubscriberColumnVisibility());

  const [pauseConfirm, setPauseConfirm] = useState<PauseConfirm | null>(null);
  const [pauseResult, setPauseResult] = useState<PauseResult | null>(null);
  const [resumeConfirm, setResumeConfirm] = useState<ResumeConfirm | null>(
    null,
  );
  const [resumeResult, setResumeResult] = useState<ResumeResult | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkConfirm, setBulkConfirm] = useState<BulkConfirm | null>(null);

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

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.statusGroup) params.set('statusGroup', filters.statusGroup);
    if (filters.frequency) params.set('frequency', filters.frequency);
    if (filters.search.trim()) params.set('q', filters.search.trim());
    if (filters.plataforma.trim())
      params.set('plataforma', filters.plataforma.trim());
    if (filters.dateRange.start)
      params.set('criadoDe', toLocalYmd(filters.dateRange.start));
    if (filters.dateRange.end)
      params.set('criadoAte', toLocalYmd(filters.dateRange.end));
    if (currentPage > 1) params.set('page', String(currentPage));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [filters, currentPage, router, pathname]);

  const appliedFilterBadge = useMemo(() => {
    let n = 0;
    if (filters.search.trim()) n += 1;
    if (filters.statusGroup) n += 1;
    if (filters.frequency) n += 1;
    if (filters.plataforma.trim()) n += 1;
    if (filters.dateRange.start || filters.dateRange.end) n += 1;
    return n;
  }, [filters]);

  const { data, isFetching, isPending, isError, refetch } = useQuery({
    queryKey: ['assinantes', currentPage, filters],
    queryFn: () =>
      listAssinantes(api, {
        page: currentPage,
        pageSize: TABLE_PAGE_SIZE,
        search: filters.search.trim() || undefined,
        platform: filters.plataforma || undefined,
        statusGroup: filters.statusGroup || undefined,
        frequency: filters.frequency || undefined,
        firstChargeFrom: filters.dateRange.start?.toISOString(),
        firstChargeTo: filters.dateRange.end
          ? endOfLocalDay(filters.dateRange.end).toISOString()
          : undefined,
      }),
    staleTime: 30 * 1000,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelAssinante(api, id),
    onSuccess: () => {
      setSelectedRowIds(new Set());
      toast({
        type: 'success',
        title: 'Assinatura desativada',
        description: 'A assinatura foi desativada com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['assinantes'] });
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível desativar a assinatura.';
      toast({ type: 'error', title: 'Erro', description: message });
    },
  });

  const removeHistoryMutation = useMutation({
    mutationFn: (id: string) => removeAssinanteFromHistory(api, id),
    onSuccess: () => {
      setSelectedRowIds(new Set());
      setCurrentPage(1);
      toast({
        type: 'success',
        title: 'Removida do histórico',
        description: 'A assinatura inativa não aparecerá mais nesta listagem.',
      });
      queryClient.invalidateQueries({ queryKey: ['assinantes'] });
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível remover a assinatura do histórico.';
      toast({ type: 'error', title: 'Erro', description: message });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseAssinante(api, id),
    onSuccess: (result) => {
      const name = pauseConfirm?.name ?? '';
      setPauseConfirm(null);
      setSelectedRowIds(new Set());
      setPauseResult({ ...result, name });
      queryClient.invalidateQueries({ queryKey: ['assinantes'] });
    },
    onError: (error) => {
      setPauseConfirm(null);
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível pausar a assinatura.';
      toast({ type: 'error', title: 'Erro ao pausar', description: message });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeAssinante(api, id),
    onSuccess: (result) => {
      const name = resumeConfirm?.name ?? '';
      setResumeConfirm(null);
      setSelectedRowIds(new Set());
      setResumeResult({ ...result, name });
      queryClient.invalidateQueries({ queryKey: ['assinantes'] });
    },
    onError: (error) => {
      setResumeConfirm(null);
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível retomar a assinatura.';
      toast({ type: 'error', title: 'Erro ao retomar', description: message });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async ({ action, rows }: BulkConfirm) => {
      const results = await Promise.allSettled(
        rows.map((row) => {
          if (action === 'desativar') return cancelAssinante(api, row.id);
          if (action === 'pausar') return pauseAssinante(api, row.id);
          return removeAssinanteFromHistory(api, row.id);
        }),
      );
      return {
        succeeded: results.filter((result) => result.status === 'fulfilled')
          .length,
        failed: results.filter((result) => result.status === 'rejected').length,
      };
    },
    onSuccess: ({ succeeded, failed }, { action }) => {
      if (action === 'excluir') setCurrentPage(1);
      setBulkConfirm(null);
      setSelectedRowIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['assinantes'] });
      if (failed) {
        toast({
          type: 'error',
          title: 'Ação concluída parcialmente',
          description: `${succeeded} concluída(s) e ${failed} não puderam ser processada(s).`,
        });
      } else {
        toast({
          type: 'success',
          title: 'Ação em lote concluída',
          description: `${succeeded} assinatura(s) processada(s).`,
        });
      }
    },
    onError: () => {
      setBulkConfirm(null);
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível processar as assinaturas selecionadas.',
      });
    },
  });

  const rows = data?.rows ?? [];
  const apiHasNextPage = data?.hasNextPage ?? false;
  const totalPages = Math.max(
    1,
    Math.ceil((data?.total ?? 0) / TABLE_PAGE_SIZE),
  );

  const selectedRows = rows.filter((row) => selectedRowIds.has(row.id));
  const selectedActiveRows = selectedRows.filter((row) => row.active);
  const selectedHistoryRows = selectedRows.filter(
    (row) => row.deactivated && !row.isPaused,
  );

  function toggleRowSelection(rowId: string, checked: boolean) {
    setSelectedRowIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function togglePageSelection(checked: boolean) {
    setSelectedRowIds((previous) => {
      const next = new Set(previous);
      for (const row of rows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  function requestBulkAction(action: BulkAction) {
    const eligibleRows =
      action === 'excluir' ? selectedHistoryRows : selectedActiveRows;
    if (eligibleRows.length === 0) return;
    setBulkConfirm({ action, rows: eligibleRows });
  }

  function handleRowAction(action: SubscriberAction, rowId: string) {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;

    if (action === 'pausar') {
      if (!row.active) {
        toast({
          type: 'error',
          title: 'Assinatura inativa',
          description: 'Somente assinaturas ativas podem ser pausadas.',
        });
        return;
      }
      setPauseConfirm({ rowId, name: row.name });
      return;
    }

    if (action === 'retomar') {
      if (!row.isPaused) {
        toast({
          type: 'error',
          title: 'Não está pausada',
          description: 'Esta assinatura não está pausada.',
        });
        return;
      }
      setResumeConfirm({
        rowId,
        name: row.name,
        remainingDays: row.remainingDays,
      });
      return;
    }

    if (action === 'desativar') {
      if (!row.active && !row.isPaused) {
        toast({
          type: 'error',
          title: 'Assinatura já inativa',
          description: 'Esta assinatura já está desativada.',
        });
        return;
      }
      cancelMutation.mutate(rowId);
      return;
    }

    if (action === 'excluir') {
      if (!isMasterAdmin || !row.deactivated || row.isPaused) {
        toast({
          type: 'error',
          title: 'Ação indisponível',
          description:
            'Somente o admin master pode remover assinaturas inativas do histórico.',
        });
        return;
      }
      removeHistoryMutation.mutate(rowId);
    }
  }

  return (
    <>
      {bulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {bulkConfirm.action === 'pausar'
                ? 'Pausar assinaturas'
                : bulkConfirm.action === 'desativar'
                  ? 'Desativar assinaturas'
                  : 'Excluir do histórico'}
            </h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Confirmar esta ação para{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {bulkConfirm.rows.length} assinatura(s)
              </span>
              ?
            </p>
            {bulkConfirm.action === 'pausar' && (
              <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                A cobrança automática será cancelada e os dias restantes serão
                gravados para cada assinatura.
              </p>
            )}
            {bulkConfirm.action === 'excluir' && (
              <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                Os registros serão ocultados apenas do histórico do SimintPay;
                nada será apagado na DOM Pagamentos.
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setBulkConfirm(null)}
                disabled={bulkMutation.isPending}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => bulkMutation.mutate(bulkConfirm)}
                disabled={bulkMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {bulkMutation.isPending ? 'Processando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Pause confirmation modal ── */}
      {pauseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Pausar assinatura
            </h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Tem certeza que deseja pausar a assinatura de{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {pauseConfirm.name}
              </span>
              ?
            </p>
            <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              A assinatura na DOM Pagamentos será cancelada. Os dias restantes
              serão armazenados e o cliente poderá retomar quando quiser.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPauseConfirm(null)}
                disabled={pauseMutation.isPending}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => pauseMutation.mutate(pauseConfirm.rowId)}
                disabled={pauseMutation.isPending}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
              >
                {pauseMutation.isPending ? 'Pausando…' : 'Confirmar pausa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pause result modal (warning to show admin) ── */}
      {pauseResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Assinatura pausada
            </h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              A assinatura de{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {pauseResult.name}
              </span>{' '}
              foi pausada com sucesso.
            </p>
            <div className="mb-4 rounded-lg bg-zinc-50 px-4 py-3 text-sm dark:bg-white/5">
              <p className="text-zinc-500 dark:text-zinc-400">
                Dias restantes gravados
              </p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {pauseResult.remainingDays} dias
              </p>
            </div>
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <p className="mb-1 font-semibold">
                Aviso para informar ao cliente:
              </p>
              <p>{pauseResult.warningMessage}</p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPauseResult(null)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resume confirmation modal ── */}
      {resumeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Retomar assinatura
            </h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Tem certeza que deseja retomar a assinatura de{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {resumeConfirm.name}
              </span>
              ?
            </p>
            {resumeConfirm.remainingDays !== null && (
              <div className="mb-4 rounded-lg bg-zinc-50 px-4 py-3 text-sm dark:bg-white/5">
                <p className="text-zinc-500 dark:text-zinc-400">
                  Dias restantes a restituir
                </p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {resumeConfirm.remainingDays} dias
                </p>
              </div>
            )}
            <p className="mb-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
              O acesso será restaurado a partir de hoje pelo tempo restante
              gravado. Nenhuma nova assinatura na DOM Pagamentos será criada.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setResumeConfirm(null)}
                disabled={resumeMutation.isPending}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => resumeMutation.mutate(resumeConfirm.rowId)}
                disabled={resumeMutation.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {resumeMutation.isPending ? 'Retomando…' : 'Confirmar retomada'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resume result modal ── */}
      {resumeResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Assinatura retomada
            </h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              A assinatura de{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {resumeResult.name}
              </span>{' '}
              foi retomada com sucesso.
            </p>
            <div className="mb-6 rounded-lg bg-zinc-50 px-4 py-3 text-sm dark:bg-white/5">
              <p className="text-zinc-500 dark:text-zinc-400">
                Novo acesso válido até
              </p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {new Date(resumeResult.newExpiresAt).toLocaleDateString(
                  'pt-BR',
                )}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                ({resumeResult.remainingDays} dias restituídos)
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setResumeResult(null)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-full min-h-0 flex-col gap-4">
        <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <Link
            href="/planos"
            className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
          >
            Planos de assinaturas
          </Link>
          <span className="mx-2 text-zinc-400">&gt;</span>
          <span className="text-zinc-400">Seus assinantes</span>
        </nav>

        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold">Assinantes</h1>
        </div>

        <SubscribersFilters
          fieldTheme={fieldTheme}
          filters={filters}
          isFetching={isFetching}
          appliedFilterBadge={appliedFilterBadge}
          columnSelectedMap={columnVisibility}
          onToggleColumn={(key) =>
            setColumnVisibility((prev) => ({
              ...prev,
              [key]: !prev[key],
            }))
          }
          onChange={(next) => {
            setFilters((prev) => ({ ...prev, ...next }));
            setCurrentPage(1);
            setSelectedRowIds(new Set());
          }}
          onClear={() => {
            const initial = {
              search: '',
              statusGroup: '',
              frequency: '',
              plataforma: '',
              dateRange: { start: null, end: null },
            };
            setFilters(initial);
            setCurrentPage(1);
            setSelectedRowIds(new Set());
            setColumnVisibility(getDefaultSubscriberColumnVisibility());
            toast({ type: 'info', title: 'Filtros limpos' });
          }}
        />

        {selectedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
            <span className="mr-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {selectedRows.length} selecionada(s)
            </span>
            <button
              type="button"
              disabled={
                selectedActiveRows.length === 0 || bulkMutation.isPending
              }
              onClick={() => requestBulkAction('pausar')}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-amber-300"
            >
              <PauseCircle className="h-4 w-4" /> Pausar (
              {selectedActiveRows.length})
            </button>
            <button
              type="button"
              disabled={
                selectedActiveRows.length === 0 || bulkMutation.isPending
              }
              onClick={() => requestBulkAction('desativar')}
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300"
            >
              <CalendarX className="h-4 w-4" /> Desativar (
              {selectedActiveRows.length})
            </button>
            {isMasterAdmin && (
              <ConfirmActionButton
                type="button"
                variant="outline"
                label={`Excluir do histórico (${selectedHistoryRows.length})`}
                confirmation="Ocultar assinaturas desativadas selecionadas? Nada será apagado na DOM."
                confirmContent={
                  <>
                    <Check className="h-4 w-4" /> Confirmar (
                    {selectedHistoryRows.length})
                  </>
                }
                disabled={
                  selectedHistoryRows.length === 0 || bulkMutation.isPending
                }
                onConfirm={() =>
                  bulkMutation.mutate({
                    action: 'excluir',
                    rows: selectedHistoryRows,
                  })
                }
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300"
              >
                <Trash2 className="h-4 w-4" /> Excluir do histórico (
                {selectedHistoryRows.length})
              </ConfirmActionButton>
            )}
            <button
              type="button"
              onClick={() => setSelectedRowIds(new Set())}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-semibold text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" /> Limpar
            </button>
          </div>
        )}

        {isError ? (
          <div role="alert" className="rounded-xl border p-5">
            <p>Não foi possível carregar os assinantes.</p>
            <button
              type="button"
              className="mt-3 cursor-pointer rounded border px-3 py-2"
              onClick={() => void refetch()}
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <SubscribersTable
            loading={isPending}
            rows={rows}
            currentPage={currentPage}
            totalPages={totalPages}
            hasNextPage={apiHasNextPage}
            rowsPerPage={TABLE_PAGE_SIZE}
            fieldTheme={fieldTheme}
            columnVisibility={columnVisibility}
            onFirstPage={() => {
              setCurrentPage(1);
              setSelectedRowIds(new Set());
            }}
            onPrevPage={() => {
              setCurrentPage((p) => Math.max(1, p - 1));
              setSelectedRowIds(new Set());
            }}
            onNextPage={() => {
              setCurrentPage((p) => p + 1);
              setSelectedRowIds(new Set());
            }}
            onLastPage={() => {
              setCurrentPage(totalPages);
              setSelectedRowIds(new Set());
            }}
            canRemoveFromHistory={isMasterAdmin}
            selectedRowIds={selectedRowIds}
            onToggleRowSelection={toggleRowSelection}
            onTogglePageSelection={togglePageSelection}
            onRowAction={handleRowAction}
          />
        )}
      </div>
    </>
  );
}
