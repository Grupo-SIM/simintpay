'use client';

import { useMemo, useState } from 'react';
import {
  Smartphone,
  RefreshCw,
  Eraser,
  QrCode,
  CreditCard,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { cn, negativeMoneyClass } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { Dropdown } from '@/components/ui/Dropdown';
import { Spinner } from '@/components/ui/Loading';

import {
  useMaquinetas,
  useSyncMaquinetas,
} from '@/features/maquinetas/hooks/use-maquinetas';
import type { MaquinetaTransacao } from '@/features/maquinetas/types/maquinetas.types';
import { DateRangePickerField } from '../relatorio/components/DateRangePickerField';
import type { DateRange } from '../relatorio/types';

type MaquinetaTableRow = MaquinetaTransacao & {
  status_details?: string | null;
  payment_method?: string | null;
  card_brand?: string | null;
  cod_external?: string | null;
};

function formatBRL(value: number | undefined | null) {
  const v = Number(value ?? 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(value: string | undefined | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapStatusLabel(status: string | undefined | null) {
  const s = (status ?? '').toUpperCase();
  if (s === 'COMPLETED') return 'Aprovado';
  if (s === 'PENDING') return 'Pendente';
  if (s === 'FAILED') return 'Recusado';
  if (s === 'REFUNDED') return 'Estornado';
  return status ?? '-';
}

function mapStatusToBadge(status: string | undefined | null): string {
  const s = (status ?? '').toUpperCase();
  if (s === 'COMPLETED') return 'COMPLETED';
  if (s === 'PENDING') return 'PENDING';
  if (s === 'FAILED') return 'FAILED';
  if (s === 'REFUNDED') return 'REFUNDED';
  return 'PENDING';
}

function PaymentMethodCell({ row }: { row: MaquinetaTableRow }) {
  const pm = (row.paymentMethod ?? '').toUpperCase();
  const isPix = pm === 'PIX';
  return (
    <div className="flex items-center justify-center gap-2">
      {isPix ? (
        <QrCode className="h-4 w-4 text-emerald-700" />
      ) : (
        <CreditCard className="h-4 w-4 text-zinc-700" />
      )}
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        {isPix ? 'Pix' : 'Cartão'}
        {row.installments > 1 ? ` ${row.installments}x` : ''}
      </span>
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'COMPLETED', label: 'Aprovado' },
  { value: 'PENDING', label: 'Pendente' },
  { value: 'FAILED', label: 'Recusado' },
];

export default function MaquinetasPage() {
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({
    start: null,
    end: null,
  });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const { data, isPending, error } = useMaquinetas({
    page,
    limit: PAGE_SIZE,
    status: statusFilter || undefined,
    startDate: dateRange.start
      ? dateRange.start.toISOString().split('T')[0]
      : undefined,
    endDate: dateRange.end
      ? dateRange.end.toISOString().split('T')[0]
      : undefined,
  });

  const {
    mutate: sync,
    isPending: isSyncing,
    data: syncResult,
    error: syncError,
  } = useSyncMaquinetas();

  const transactions = data?.transactions ?? [];
  const total = data?.meta?.total ?? 0;

  const columns = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'DATA/HORA',
        className: 'text-center',
        headerClassName: 'text-center',
        render: (row: MaquinetaTableRow) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {new Date(row.createdAt).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        ),
      },
      {
        key: 'customerName',
        header: 'TERMINAL',
        className: 'text-left pl-4',
        headerClassName: 'text-left pl-4',
        render: (row: MaquinetaTableRow) => (
          <div className="flex flex-col">
            <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[160px]">
              {row.customerName || '-'}
            </span>
          </div>
        ),
      },
      {
        key: 'profit_minus_tax',
        header: 'LUCRO LÍQUIDO',
        className: 'text-center',
        headerClassName: 'text-center',
        render: (row: MaquinetaTableRow) => (
          <span
            className={cn(
              'font-semibold text-green-600 dark:text-green-400',
              negativeMoneyClass(row.netbalancemachine),
            )}
          >
            {formatBRL(row.netbalancemachine)}
          </span>
        ),
      },
      {
        key: 'status_details',
        header: 'STATUS',
        className: 'text-center',
        headerClassName: 'text-center',
        render: (row: MaquinetaTableRow) => (
          <div className="flex justify-center">
            <Badge value={mapStatusToBadge(row.status)}>
              {row.status_details ||
                row.statusDetails ||
                mapStatusLabel(row.status)}
            </Badge>
          </div>
        ),
      },
      {
        key: 'payment_method',
        header: 'MÉTODO',
        className: 'text-center',
        headerClassName: 'text-center',
        render: (row: MaquinetaTableRow) => {
          const method = row.payment_method || row.paymentMethod;
          return (
            <span className="text-sm text-zinc-600 dark:text-zinc-400 capitalize">
              {method === 'credit_card'
                ? 'Cartão'
                : method === 'debit'
                  ? 'Débito'
                  : method}
            </span>
          );
        },
      },
      {
        key: 'card_brand',
        header: 'BANDEIRA',
        className: 'text-center',
        headerClassName: 'text-center',
        render: (row: MaquinetaTableRow) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {row.card_brand || row.cardBrand || '-'}
          </span>
        ),
      },
      {
        key: 'cod_external',
        header: 'NSU',
        className: 'text-center',
        headerClassName: 'text-center',
        render: (row: MaquinetaTableRow) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {row.cod_external || row.domTransactionId || '-'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Maquinetas</h1>
        <button
          type="button"
          onClick={() => sync()}
          disabled={isSyncing}
          className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-violet-700 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Sincronizando...' : 'Sincronizar histórico'}
        </button>
      </div>

      {syncResult && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
          {syncResult.message}
        </div>
      )}

      {syncError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          Erro ao sincronizar: {(syncError as Error).message}
        </div>
      )}

      <div className="relative z-30 rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div className="grid gap-3 md:grid-cols-2">
          <DateRangePickerField
            label="Período:"
            value={dateRange}
            onChange={(next) => {
              setDateRange(next);
              setPage(1);
            }}
            theme={fieldTheme}
          />
          <Dropdown
            label="Status:"
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            theme={fieldTheme}
            variant="navbar"
            options={STATUS_OPTIONS}
          />
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setStatusFilter('');
              setDateRange({ start: null, end: null });
              setPage(1);
            }}
            className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
          >
            <Eraser className="h-4 w-4" />
            Limpar filtros
          </button>
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {(error as Error).message}
          </div>
        ) : null}
      </div>

      {isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={40} />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={transactions}
          loading={isPending}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          minWidth="min-w-[1100px]"
        />
      )}
    </div>
  );
}
