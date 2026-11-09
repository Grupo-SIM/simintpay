'use client';

import { useState, Suspense, useCallback, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Download,
  Eye,
  EyeOff,
  Upload,
  Eraser,
  Landmark,
  List,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { Dropdown } from '@/components/ui/Dropdown';
import { Spinner } from '@/components/ui/Loading';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { ActionButton } from '../../relatorio/components/ActionButton';
import { DateRangePickerField } from '../../relatorio/components/DateRangePickerField';
import type { DateRange } from '../../relatorio/types';

import {
  useSaquesAdmin,
  useToggleComprovanteVisivel,
} from '@/features/saques/hooks/use-saques';
import {
  AcquirerWithdrawalsModal,
  RegisterAcquirerWithdrawalModal,
} from '@/features/saques/components/AcquirerWithdrawalsSection';
import { AdminActionsModal } from '@/features/saques/components/AdminActionsModal';
import { RejectionTooltip } from '@/features/saques/components/RejectionTooltip';
import { UpdateReceiptModal } from '@/features/saques/components/UpdateReceiptModal';
import { ViewReceiptModal } from '@/features/saques/components/ViewReceiptModal';
import { ViewRejectionModal } from '@/features/saques/components/ViewRejectionModal';
import { useCurrentUser } from '@/hooks/use-current-user';
import type { Saque } from '@/features/saques/types/saques.types';
import {
  isComprovantePdfUrl,
  resolveComprovanteUrl,
} from '@/features/saques/utils/comprovante-url';
import {
  buildAdminDateRangeParam,
  filterSaquesByDateRange,
  normalizeDateFilterRange,
  parseDateRangeFromYmd,
  parseQueryDate,
  resolveYmdDateFilter,
  toLocalYmd,
} from '@/features/saques/utils/date-filter';
import { handleForceDownload } from '@/features/saques/utils/download-comprovante';
import {
  DATE_FILTER_FETCH_SIZE,
  TABLE_PAGE_SIZE,
  formatBRL,
  formatDate,
  isSaqueAguardandoAcaoAdmin,
  mapStatusBadgeValue,
  mapStatusLabel,
} from '@/features/saques/utils/saques-format';

// ── Main Page Content ────────────────────────────────────────────────────────

function AdminSaquesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [page, setPage] = useState(() => Number(searchParams.get('page') ?? 1));
  const [statusFilter, setStatusFilter] = useState(
    () => searchParams.get('status') ?? 'all',
  );
  const [moduloFilter, setModuloFilter] = useState(
    () => searchParams.get('search') ?? '',
  );
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    parseDateRangeFromYmd(
      searchParams.get('dataInicio') || undefined,
      searchParams.get('dataFim') || undefined,
    ),
  );
  const [acquirerModalOpen, setAcquirerModalOpen] = useState(false);
  const [acquirerListOpen, setAcquirerListOpen] = useState(false);

  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [selectedSaque, setSelectedSaque] = useState<Saque | null>(null);
  const [adminActionType, setAdminActionType] = useState<'APPROVE' | 'REJECT'>(
    'APPROVE',
  );

  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [selectedReceiptSaqueId, setSelectedReceiptSaqueId] = useState<
    string | null
  >(null);
  const [selectedReceiptUrl, setSelectedReceiptUrl] = useState<string | null>(
    null,
  );

  const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
  const [selectedRejectionSaque, setSelectedRejectionSaque] =
    useState<Saque | null>(null);

  const [updateReceiptOpen, setUpdateReceiptOpen] = useState(false);
  const [selectedUpdateSaque, setSelectedUpdateSaque] = useState<Saque | null>(
    null,
  );

  const toggleVisibilMutation = useToggleComprovanteVisivel();
  const { toast } = useToast();

  const { user, loading: userLoading } = useCurrentUser();
  const isAdmin = user?.isAdmin ?? false;

  useEffect(() => {
    if (!userLoading && !isAdmin) router.replace('/saques');
  }, [userLoading, isAdmin, router]);

  // Sync state with searchParams for UX consistency (e.g. back button)
  const searchKey = searchParams.toString();
  const [previousSearchKey, setPreviousSearchKey] = useState(searchKey);
  if (searchKey !== previousSearchKey) {
    setPreviousSearchKey(searchKey);
    setPage(Number(searchParams.get('page') ?? 1));
    setStatusFilter(searchParams.get('status') ?? 'all');
    setModuloFilter(searchParams.get('search') ?? '');
    setDateRange(
      parseDateRangeFromYmd(
        searchParams.get('dataInicio') || undefined,
        searchParams.get('dataFim') || undefined,
      ),
    );
  }

  const updateUrl = useCallback(
    (params: Record<string, string | number | undefined | Date | null>) => {
      const urlParams = new URLSearchParams(searchParams.toString());
      Object.entries(params).forEach(([k, v]) => {
        if (v instanceof Date) {
          urlParams.set(k, toLocalYmd(v));
        } else if (v != null && v !== '') {
          urlParams.set(k, String(v));
        } else {
          urlParams.delete(k);
        }
      });
      if (Object.keys(params).some((k) => k !== 'page')) {
        urlParams.delete('page');
        urlParams.set('page', '1');
      }
      router.push(`${pathname}?${urlParams.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const queryParams = useMemo(() => {
    const { dataInicio, dataFim } = resolveYmdDateFilter(
      searchParams.get('dataInicio') || undefined,
      searchParams.get('dataFim') || undefined,
    );
    const hasDateFilter = !!(dataInicio || dataFim);
    const start = parseQueryDate(dataInicio ?? null);
    const end = parseQueryDate(dataFim ?? null);
    return {
      page: hasDateFilter ? 1 : Number(searchParams.get('page') ?? 1),
      pageSize: hasDateFilter ? DATE_FILTER_FETCH_SIZE : TABLE_PAGE_SIZE,
      status: (searchParams.get('status') as Saque['status']) || undefined,
      dataInicio,
      dataFim,
      dateRange: buildAdminDateRangeParam(start, end),
    };
  }, [searchParams]);

  const adminQueryParams = useMemo(
    () => ({
      ...queryParams,
      search: searchParams.get('search') || undefined,
    }),
    [queryParams, searchParams],
  );

  const { data, isPending } = useSaquesAdmin(adminQueryParams, {
    enabled: !userLoading && isAdmin,
  });

  const tableView = useMemo(() => {
    const rows = data?.data ?? [];
    const { start, end } = parseDateRangeFromYmd(
      searchParams.get('dataInicio') || undefined,
      searchParams.get('dataFim') || undefined,
    );
    const hasDateFilter = !!(start || end);

    if (!hasDateFilter) {
      return {
        rows,
        page: data?.page ?? 1,
        total: data?.total ?? 0,
        pageSize: TABLE_PAGE_SIZE,
      };
    }

    const filtered = filterSaquesByDateRange(rows, start, end);
    const currentPage = Number(searchParams.get('page') ?? 1);
    const startIdx = (currentPage - 1) * TABLE_PAGE_SIZE;
    return {
      rows: filtered.slice(startIdx, startIdx + TABLE_PAGE_SIZE),
      page: currentPage,
      total: filtered.length,
      pageSize: TABLE_PAGE_SIZE,
    };
  }, [data, searchParams]);

  const columns = useMemo(() => {
    const cols = [
      {
        key: 'criadoEm',
        header: 'Data',
        render: (row: Saque) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatDate(row.criadoEm)}
          </span>
        ),
      },
      {
        key: 'usuario_nome',
        header: 'Nome/Plataforma',
        render: (row: Saque) => (
          <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {(row.cliente ?? row.usuario)?.nome ?? '---'}
          </span>
        ),
      },
      {
        key: 'usuario_email',
        header: 'Email',
        render: (row: Saque) => (
          <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
            {(row.cliente ?? row.usuario)?.email ?? '---'}
          </span>
        ),
      },
      {
        key: 'valor',
        header: 'Valor solicitado',
        render: (row: Saque) => (
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {formatBRL(row.valor)}
          </span>
        ),
      },
      {
        key: 'valorAReceber',
        header: 'Valor a receber',
        render: (row: Saque) => {
          const taxaTotal = row.taxas?.total ?? row.taxa ?? 0;
          const net =
            taxaTotal > 0
              ? row.valor - taxaTotal
              : (row.valorLiquido ?? row.valor);
          return (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {formatBRL(net)}
            </span>
          );
        },
      },
      {
        key: 'chavePix',
        header: 'Chave PIX',
        render: (row: Saque) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {row.chavePix ?? '---'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row: Saque) => {
          const badge = (
            <Badge value={mapStatusBadgeValue(row.status)}>
              {mapStatusLabel(row.status)}
            </Badge>
          );
          const isRejected = [
            'REJEITADO',
            'REJECTED',
            'RECUSADO',
            'RECUSADA',
          ].includes((row.status ?? '').toUpperCase());
          const motivo = row.rejectionReason || row.observacao;
          if (isRejected && motivo) {
            return <RejectionTooltip reason={motivo}>{badge}</RejectionTooltip>;
          }
          return badge;
        },
      },
      {
        key: 'comprovante',
        header: 'Nota Fiscal',
        render: (row: Saque) => {
          const statusUp = (row.status ?? '').toUpperCase();
          const isRejected = [
            'REJEITADO',
            'REJECTED',
            'RECUSADO',
            'RECUSADA',
          ].includes(statusUp);
          const isApproved = [
            'APROVADO',
            'APROVADA',
            'APPROVED',
            'PAGO',
            'COMPLETED',
          ].includes(statusUp);
          const img = row.comprovante || row.receiptImage;
          const visivel = row.comprovanteVisivel !== false;

          if (isRejected) {
            return (
              <div className="flex justify-center">
                <button
                  onClick={() => {
                    setSelectedRejectionSaque(row);
                    setRejectionModalOpen(true);
                  }}
                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 dark:text-red-400 transition-colors"
                  title="Ver motivo da recusa"
                >
                  <Eye size={16} />
                </button>
              </div>
            );
          }

          if (isAdmin && isApproved) {
            return (
              <div className="flex flex-col items-center gap-2 min-w-[130px]">
                {/* Visualizar + Download */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setSelectedReceiptSaqueId(row.id);
                      setSelectedReceiptUrl(img ?? null);
                      setReceiptModalOpen(true);
                    }}
                    className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-colors"
                    title="Visualizar Nota Fiscal"
                  >
                    <Eye size={15} />
                  </button>
                  {img && (
                    <button
                      onClick={() =>
                        handleForceDownload(
                          row.id,
                          img,
                          `nota_fiscal_${row.id}${isComprovantePdfUrl(resolveComprovanteUrl(img)) ? '.pdf' : '.png'}`,
                        )
                      }
                      className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
                      title="Baixar Nota Fiscal"
                    >
                      <Download size={15} />
                    </button>
                  )}
                  {/* Trocar / Adicionar */}
                  <button
                    onClick={() => {
                      setSelectedUpdateSaque(row);
                      setUpdateReceiptOpen(true);
                    }}
                    className="p-1.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-500/10 text-violet-600 dark:text-violet-400 transition-colors"
                    title={img ? 'Trocar comprovante' : 'Adicionar comprovante'}
                  >
                    <Upload size={15} />
                  </button>
                </div>
                {/* Toggle visível para cliente */}
                <button
                  disabled={toggleVisibilMutation.isPending}
                  onClick={() =>
                    toggleVisibilMutation.mutate(
                      { id: row.id, visivel: !visivel },
                      {
                        onError: (err) =>
                          toast({
                            type: 'error',
                            title: 'Erro',
                            description:
                              err.message || 'Erro ao alterar visibilidade',
                          }),
                      },
                    )
                  }
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all border',
                    visivel
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400'
                      : 'bg-zinc-100 border-zinc-300 text-zinc-500 hover:bg-zinc-200 dark:bg-white/5 dark:border-white/10 dark:text-zinc-500',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                  title={
                    visivel
                      ? 'Visível para cliente — clique para ocultar'
                      : 'Oculto para cliente — clique para exibir'
                  }
                >
                  {visivel ? <Eye size={10} /> : <EyeOff size={10} />}
                  {visivel ? 'Visível' : 'Oculto'}
                </button>
              </div>
            );
          }

          return <span className="text-zinc-400 text-xs">Não disponível</span>;
        },
      },
    ];

    cols.push({
      key: 'actions',
      header: 'Ações',
      render: (row: Saque) => (
        <div className="flex justify-center flex-wrap gap-2 min-w-[140px]">
          {isSaqueAguardandoAcaoAdmin(row.status) ? (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSelectedSaque(row);
                  setAdminActionType('APPROVE');
                  setAdminModalOpen(true);
                }}
                className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
              >
                Confirmar
              </button>
              <button
                onClick={() => {
                  setSelectedSaque(row);
                  setAdminActionType('REJECT');
                  setAdminModalOpen(true);
                }}
                className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-all border border-red-400/20"
              >
                Negar
              </button>
            </div>
          ) : (
            <span className="text-xs text-zinc-500 italic">Finalizado</span>
          )}
        </div>
      ),
    });

    return cols;
  }, [isAdmin]);

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Saques</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Histórico de transferências
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton
            variant="outline"
            onClick={() => setAcquirerListOpen(true)}
          >
            <List className="h-4 w-4" />
            Saques de adquirente
          </ActionButton>
          <ActionButton
            variant="primary"
            onClick={() => setAcquirerModalOpen(true)}
          >
            <Landmark className="h-4 w-4" />
            Registrar saque de adquirente
          </ActionButton>
        </div>
      </div>

      <div className="relative z-30 rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div className="grid gap-3 md:grid-cols-3">
          <DateRangePickerField
            label="Data inicial e final:"
            value={dateRange}
            onChange={(next) => {
              const { start, end } = normalizeDateFilterRange(
                next.start,
                next.end,
              );
              setDateRange({ start, end });
              setPage(1);
              updateUrl({
                dataInicio: start,
                dataFim: end,
              });
            }}
            theme={fieldTheme}
          />
          <Dropdown
            label="Status:"
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
              updateUrl({ status: v !== 'all' ? v : undefined });
            }}
            theme={fieldTheme}
            variant="navbar"
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'PENDENTE', label: 'Pendente' },
              { value: 'APROVADO', label: 'Aprovado' },
              { value: 'REJEITADO', label: 'Recusado' },
            ]}
          />
          <Input
            label="Pesquisar:"
            placeholder="Nome ou email..."
            value={moduloFilter}
            onChange={(v) => {
              setModuloFilter(v);
              setPage(1);
              updateUrl({ search: v || undefined });
            }}
            theme={fieldTheme}
            variant="navbar"
          />
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setStatusFilter('all');
              setModuloFilter('');
              setDateRange({ start: null, end: null });
              setPage(1);
              router.push(pathname);
            }}
            className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
          >
            <Eraser className="h-4 w-4" />
            Limpar filtros
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={tableView.rows}
        loading={isPending}
        page={tableView.page}
        pageSize={tableView.pageSize}
        total={tableView.total}
        onPageChange={(p) => {
          setPage(p);
          updateUrl({ page: p });
        }}
        minWidth="min-w-[1200px]"
      />

      <AcquirerWithdrawalsModal
        open={acquirerListOpen}
        onClose={() => setAcquirerListOpen(false)}
      />
      <RegisterAcquirerWithdrawalModal
        open={acquirerModalOpen}
        onClose={() => setAcquirerModalOpen(false)}
      />
      <AdminActionsModal
        key={`${selectedSaque?.id ?? 'none'}-${adminActionType}`}
        open={adminModalOpen}
        onClose={() => setAdminModalOpen(false)}
        saque={selectedSaque}
        type={adminActionType}
      />
      <ViewReceiptModal
        open={receiptModalOpen}
        onClose={() => {
          setReceiptModalOpen(false);
          setSelectedReceiptSaqueId(null);
          setSelectedReceiptUrl(null);
        }}
        saqueId={selectedReceiptSaqueId}
        hintUrl={selectedReceiptUrl}
      />
      <ViewRejectionModal
        open={rejectionModalOpen}
        onClose={() => {
          setRejectionModalOpen(false);
          setSelectedRejectionSaque(null);
        }}
        saque={selectedRejectionSaque}
      />
      <UpdateReceiptModal
        open={updateReceiptOpen}
        onClose={() => {
          setUpdateReceiptOpen(false);
          setSelectedUpdateSaque(null);
        }}
        saque={selectedUpdateSaque}
      />
    </div>
  );
}

export default function AdminSaquesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center">
          <Spinner size={40} />
        </div>
      }
    >
      <AdminSaquesContent />
    </Suspense>
  );
}
