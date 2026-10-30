'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { startOfDay } from '@/app/(dashboard)/relatorio/utils';
import { BulkActionsBar } from '@/components/ui/BulkActionsBar';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';
import { useToast } from '@/components/ui/Toast';
import { useBulkSelect } from '@/hooks/use-bulk-select';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { getDefaultPlanColumnVisibility } from './column-config';
import { PlansFilters } from './components/PlansFilters';
import { PlansTable } from './components/PlansTable';
import type { PlanFiltersState, PlanRow } from './types';

interface ApiPlan {
  id: string;
  nome?: string;
  /** Resposta BFF em inglês */
  name?: string;
  descricao?: string | null;
  preco?: number;
  price?: number;
  tipo?: string;
  type?: string;
  ativo?: boolean;
  isActive?: boolean;
  /** Alguns proxies enviam string/número */
  active?: boolean | string | number;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  criadoEm?: string;
  createdAt?: string;
  cpfDono?: string | null;
  donoNome?: string | null;
  donoEmail?: string | null;
  plataforma?: string | null;
  plataformas?: string[];
  status?: string;
}

const INTERVAL_MAP: Record<string, string> = {
  SEMANAL: 'A cada semana',
  MENSAL: 'A cada mês',
  ANUAL: 'A cada ano',
  WEEKLY: 'A cada semana',
  MONTHLY: 'A cada mês',
  YEAR: 'A cada ano',
  WEEK: 'A cada semana',
  MONTH: 'A cada mês',
};

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

function planCreatedInRange(
  iso: string | null,
  range: PlanFiltersState['dateRange'],
): boolean {
  if (!range.start && !range.end) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (range.start && t < startOfDay(range.start).getTime()) return false;
  if (range.end && t > endOfLocalDay(range.end).getTime()) return false;
  return true;
}

/** BFF pode enviar `ativo`, `isActive`, número ou string — antes só `ativo` era lido e `isActive` virava sempre "Ativo". */
function mapApiPlanStatus(raw: ApiPlan): 'Ativo' | 'Inativo' {
  const v: unknown = raw.ativo ?? raw.isActive ?? raw.active;
  if (typeof v === 'boolean') return v ? 'Ativo' : 'Inativo';
  if (typeof v === 'number') return v === 0 ? 'Inativo' : 'Ativo';
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (
      ['0', 'false', 'no', 'inactive', 'inativo', 'disabled', 'off'].includes(s)
    )
      return 'Inativo';
    if (['1', 'true', 'yes', 'active', 'ativo', 'enabled', 'on'].includes(s))
      return 'Ativo';
  }
  const st = String(raw.status ?? '').toLowerCase();
  if (st && /inactive|inativ|disabled|cancel/.test(st)) return 'Inativo';
  if (st && /active|ativ|enabled/.test(st)) return 'Ativo';
  return 'Ativo';
}

function mapPlan(raw: ApiPlan): PlanRow {
  const createdSrc = raw.criadoEm ?? raw.createdAt;
  const tipo = raw.tipo ?? raw.type ?? '';
  return {
    id: raw.id,
    name: raw.nome ?? raw.name ?? '—',
    isActive: mapApiPlanStatus(raw) === 'Ativo',
    plataforma: raw.plataforma ?? null,
    plataformas: raw.plataformas ?? [],
    paymentLink: `${process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL}/?simPlanCode=${raw.id}`,
    interval: (INTERVAL_MAP[tipo] ?? tipo) || '—',
    paymentMethod: '—',
    status: mapApiPlanStatus(raw),
    activeSubs: 0,
    inactiveSubs: 0,
    createdAt: createdSrc
      ? new Date(createdSrc).toLocaleString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : '—',
    createdAtIso: createdSrc ?? null,
    cpfDono: raw.cpfDono ?? null,
    donoNome: raw.donoNome ?? null,
    donoEmail: raw.donoEmail ?? null,
  };
}

type ConfirmDialog = {
  action: 'desativar' | 'ativar' | 'excluir';
  rowId: string;
  planName: string;
} | null;

export default function PlanosPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const initialDateRange = {
    start: parseYmdParam(searchParams.get('criadoDe')),
    end: parseYmdParam(searchParams.get('criadoAte')),
  };

  const [filters, setFilters] = useState<PlanFiltersState>({
    dateRange: initialDateRange,
    planName: searchParams.get('planName') ?? '',
    status: searchParams.get('status') ?? 'all',
    platform: searchParams.get('platform') ?? 'all',
  });
  const [currentPage, setCurrentPage] = useState(
    Number(searchParams.get('page') ?? '1'),
  );
  const [rowsPerPage] = useState(20);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => getDefaultPlanColumnVisibility());
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>(null);
  const bulk = useBulkSelect();
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

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
    if (filters.dateRange.start)
      params.set('criadoDe', toLocalYmd(filters.dateRange.start));
    if (filters.dateRange.end)
      params.set('criadoAte', toLocalYmd(filters.dateRange.end));
    if (filters.planName.trim())
      params.set('planName', filters.planName.trim());
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.platform !== 'all') params.set('platform', filters.platform);
    if (currentPage > 1) params.set('page', String(currentPage));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [filters, currentPage, router, pathname]);

  const { data: apiData, isFetching } = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<{ data: ApiPlan[] }>(endpoints.planos.list, {}),
    staleTime: 60 * 1000,
  });

  const { data: taxasRes } = useQuery({
    queryKey: ['admin', 'platform-taxas'],
    queryFn: () =>
      api.get<{ data: Record<string, unknown> }>(
        endpoints.admin.plataformas.taxasList,
      ),
    staleTime: 5 * 60 * 1000,
  });
  const platformTags = useMemo(() => {
    if (!taxasRes?.data) return [];
    return Object.keys(taxasRes.data)
      .filter((t) => !['FRENDZ', 'REVALIDA'].includes(t.toUpperCase()))
      .sort();
  }, [taxasRes]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(endpoints.planos.delete(id)),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Plano excluído',
        description: 'O plano foi excluído com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setConfirmDialog(null);
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível excluir o plano.',
      });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => api.delete(endpoints.planos.delete(id))),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      return { ok, fail: results.length - ok };
    },
    onSuccess: ({ ok, fail }) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      bulk.clear();
      setBulkConfirmOpen(false);
      if (fail === 0)
        toast({
          type: 'success',
          title: 'Planos excluídos',
          description: `${ok} plano(s) excluído(s).`,
        });
      else if (ok === 0)
        toast({
          type: 'error',
          title: 'Erro',
          description: `Não foi possível excluir os ${fail} plano(s) selecionado(s).`,
        });
      else
        toast({
          type: 'success',
          title: 'Parcialmente excluído',
          description: `${ok} excluído(s), ${fail} falhou(aram).`,
        });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível excluir os planos selecionados.',
      });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.post(endpoints.planos.deactivate(id), {}),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Plano desativado',
        description: 'O plano foi desativado com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setConfirmDialog(null);
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível desativar o plano.',
      });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(endpoints.planos.update(id), { isActive: true }),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Plano ativado',
        description: 'O plano foi ativado com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setConfirmDialog(null);
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível ativar o plano.',
      });
    },
  });

  const allRows: PlanRow[] = useMemo(
    () => (apiData?.data ?? []).map(mapPlan),
    [apiData],
  );

  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      const nameMatch =
        !filters.planName.trim() ||
        row.name.toLowerCase().includes(filters.planName.trim().toLowerCase());
      const statusMatch =
        filters.status === 'all' || row.status === filters.status;
      const periodMatch = planCreatedInRange(
        row.createdAtIso,
        filters.dateRange,
      );
      const platformMatch =
        filters.platform === 'all' ||
        row.plataformas.some(
          (p) => p.toUpperCase() === filters.platform.toUpperCase(),
        ) ||
        row.plataforma?.toUpperCase() === filters.platform.toUpperCase();
      return nameMatch && statusMatch && periodMatch && platformMatch;
    });
  }, [allRows, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const rows = filteredRows.slice(
    (safePage - 1) * rowsPerPage,
    safePage * rowsPerPage,
  );

  function handleRowAction(
    action: 'editar' | 'desativar' | 'ativar' | 'excluir',
    rowId: string,
  ) {
    if (action === 'editar') {
      router.push(`/planos/criar?id=${rowId}`);
      return;
    }
    const plan = allRows.find((r) => r.id === rowId);
    setConfirmDialog({ action, rowId, planName: plan?.name ?? rowId });
  }

  function handleConfirm() {
    if (!confirmDialog) return;
    if (confirmDialog.action === 'excluir') {
      deleteMutation.mutate(confirmDialog.rowId);
    } else if (confirmDialog.action === 'ativar') {
      activateMutation.mutate(confirmDialog.rowId);
    } else {
      deactivateMutation.mutate(confirmDialog.rowId);
    }
  }

  const isPending =
    deleteMutation.isPending ||
    deactivateMutation.isPending ||
    activateMutation.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Planos</h1>
        <ActionButton
          variant="primary"
          onClick={() => router.push('/planos/criar')}
        >
          <Plus className="h-4 w-4" />
          Criar plano
        </ActionButton>
      </div>

      <PlansFilters
        fieldTheme={fieldTheme}
        filters={filters}
        isFetching={isFetching}
        platformTags={platformTags}
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
        }}
        onClear={() => {
          const initial: PlanFiltersState = {
            dateRange: { start: null, end: null },
            planName: '',
            status: 'all',
            platform: 'all',
          };
          setFilters(initial);
          setCurrentPage(1);
          setColumnVisibility(getDefaultPlanColumnVisibility());
        }}
      />

      <BulkActionsBar
        count={bulk.count}
        deleting={bulkDeleteMutation.isPending}
        onClear={bulk.clear}
        onDelete={() => setBulkConfirmOpen(true)}
      />

      <PlansTable
        rows={rows}
        currentPage={safePage}
        totalPages={totalPages}
        rowsPerPage={rowsPerPage}
        fieldTheme={fieldTheme}
        columnVisibility={columnVisibility}
        onFirstPage={() => setCurrentPage(1)}
        onPrevPage={() => setCurrentPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
        onLastPage={() => setCurrentPage(totalPages)}
        onRowAction={handleRowAction}
        selectedIds={bulk.selected}
        onToggleRow={bulk.toggle}
        onToggleAll={() => bulk.toggleAll(rows.map((r) => r.id))}
      />

      <ConfirmDeleteDialog
        open={bulkConfirmOpen}
        title="Excluir planos selecionados"
        description={`Tem certeza que deseja excluir ${bulk.count} plano(s)? Esta ação não pode ser desfeita.`}
        loading={bulkDeleteMutation.isPending}
        onCancel={() => setBulkConfirmOpen(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(bulk.selected))}
      />

      {/* Modal de confirmação */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !isPending && setConfirmDialog(null)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {confirmDialog.action === 'excluir'
                ? 'Excluir plano'
                : confirmDialog.action === 'ativar'
                  ? 'Ativar plano'
                  : 'Desativar plano'}
            </h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {confirmDialog.action === 'excluir'
                ? `Tem certeza que deseja excluir o plano "${confirmDialog.planName}"? Esta ação não pode ser desfeita.`
                : confirmDialog.action === 'ativar'
                  ? `Tem certeza que deseja ativar o plano "${confirmDialog.planName}"?`
                  : `Tem certeza que deseja desativar o plano "${confirmDialog.planName}"?`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirmDialog(null)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleConfirm}
                className={
                  confirmDialog.action === 'excluir'
                    ? 'rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50'
                    : confirmDialog.action === 'ativar'
                      ? 'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50'
                      : 'rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50'
                }
              >
                {isPending
                  ? 'Aguarde...'
                  : confirmDialog.action === 'excluir'
                    ? 'Excluir'
                    : confirmDialog.action === 'ativar'
                      ? 'Ativar'
                      : 'Desativar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
