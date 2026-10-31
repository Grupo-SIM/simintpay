'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { DataTable } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { DateRangePickerField } from '@/app/(dashboard)/relatorio/components/DateRangePickerField';
import type { DateRange } from '@/app/(dashboard)/relatorio/types';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';

const PAGE_SIZE = 20;
const FETCH_BATCH = 500;

type ApiOrder = {
  id: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerDocument?: string | null;
  paymentMethod?: string | null;
  status?: string | null;
  valorCobrado?: number | null;
  criadoEm?: string | null;
};

type Row = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  paymentMethod: string;
  status: string;
  valorCobrado: number;
  criadoEm: string;
  criadoEmIso: string;
};

function mapPaymentMethod(m?: string | null) {
  if (m === 'CREDIT_CARD') return 'Cartão de crédito';
  if (m === 'PIX') return 'PIX';
  return m ?? '—';
}

function mapStatus(s?: string | null) {
  const v = (s ?? '').toUpperCase();
  if (v === 'PAID' || v === 'ACTIVE' || v === 'APPROVED') return 'Aprovado';
  if (v === 'PENDING') return 'Pendente';
  if (v === 'CANCELLED' || v === 'CANCELED') return 'Cancelado';
  if (v === 'FAILED') return 'Falhou';
  return s ?? '—';
}

function StatusPill({ raw }: { raw: string }) {
  const label = mapStatus(raw);
  const v = raw.toUpperCase();
  const cls =
    v === 'PAID' || v === 'ACTIVE' || v === 'APPROVED'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400'
      : v === 'PENDING'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
        : 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

export default function AssinantesDoLinkPage() {
  const params = useParams<{ id: string }>();
  const linkId = params?.id;
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateRange, setDateRange] = useState<DateRange>({
    start: null,
    end: null,
  });
  const [page, setPage] = useState(1);

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

  const { data, isFetching } = useQuery({
    queryKey: ['links-assinatura-assinantes', linkId],
    queryFn: async () => {
      const res = await api.get<{ data?: ApiOrder[]; total?: number }>(
        endpoints.linksAssinatura.subscribers(linkId),
        { query: { page: 1, pageSize: FETCH_BATCH } },
      );
      return (res.data ?? []).map((o): Row => ({
        id: o.id,
        customerName: o.customerName ?? '—',
        customerEmail: o.customerEmail ?? '—',
        customerDocument: o.customerDocument ?? '—',
        paymentMethod: mapPaymentMethod(o.paymentMethod),
        status: o.status ?? '',
        valorCobrado: Number(o.valorCobrado ?? 0),
        criadoEm: o.criadoEm
          ? new Date(o.criadoEm).toLocaleDateString('pt-BR')
          : '—',
        criadoEmIso: o.criadoEm ?? '',
      }));
    },
    enabled: Boolean(linkId),
    staleTime: 30 * 1000,
  });

  const allRows = data ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const from = dateRange.start;
    const to = dateRange.end
      ? new Date(
          dateRange.end.getFullYear(),
          dateRange.end.getMonth(),
          dateRange.end.getDate(),
          23,
          59,
          59,
        )
      : null;

    return allRows.filter((r) => {
      if (
        needle &&
        !r.customerName.toLowerCase().includes(needle) &&
        !r.customerEmail.toLowerCase().includes(needle) &&
        !r.customerDocument.includes(needle)
      )
        return false;
      if (statusFilter !== 'all' && mapStatus(r.status) !== statusFilter)
        return false;
      if (from && r.criadoEmIso && new Date(r.criadoEmIso) < from) return false;
      if (to && r.criadoEmIso && new Date(r.criadoEmIso) > to) return false;
      return true;
    });
  }, [allRows, search, statusFilter, dateRange]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  function handleFilterChange(fn: () => void) {
    fn();
    setPage(1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Link
          href="/links-assinatura"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Links de assinatura
        </Link>
        <span className="mx-2 text-zinc-400">&gt;</span>
        <span className="text-zinc-400">Assinantes</span>
      </nav>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-xl font-semibold">Assinantes do link</h1>
        </div>
        {!isFetching && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {filtered.length} registro{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            theme={fieldTheme}
            variant="navbar"
            label="Nome / e-mail / CPF"
            placeholder="Buscar..."
            value={search}
            onChange={(v) => handleFilterChange(() => setSearch(v))}
          />
          <Dropdown
            theme={fieldTheme}
            variant="navbar"
            portal
            label="Status"
            value={statusFilter}
            onChange={(v) =>
              handleFilterChange(() => setStatusFilter(v as string))
            }
            options={[
              { label: 'Todos', value: 'all' },
              { label: 'Aprovado', value: 'Aprovado' },
              { label: 'Pendente', value: 'Pendente' },
              { label: 'Cancelado', value: 'Cancelado' },
              { label: 'Falhou', value: 'Falhou' },
            ]}
          />
          <DateRangePickerField
            label="Período:"
            theme={fieldTheme}
            value={dateRange}
            onChange={(r) => handleFilterChange(() => setDateRange(r))}
          />
        </div>
      </div>

      <DataTable
        columns={[
          {
            key: 'customerName',
            header: 'Nome',
            defaultWidth: 180,
            render: (row) => (
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {row.customerName}
              </span>
            ),
          },
          {
            key: 'customerEmail',
            header: 'E-mail',
            defaultWidth: 220,
            render: (row) => (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {row.customerEmail}
              </span>
            ),
          },
          {
            key: 'customerDocument',
            header: 'CPF / CNPJ',
            defaultWidth: 150,
            render: (row) => (
              <span className="font-mono text-xs">{row.customerDocument}</span>
            ),
          },
          {
            key: 'paymentMethod',
            header: 'Método',
            defaultWidth: 140,
            render: (row) => row.paymentMethod,
          },
          {
            key: 'status',
            header: 'Status',
            defaultWidth: 120,
            render: (row) => <StatusPill raw={row.status} />,
          },
          {
            key: 'valorCobrado',
            header: 'Valor cobrado',
            defaultWidth: 130,
            render: (row) =>
              row.valorCobrado.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              }),
          },
          {
            key: 'criadoEm',
            header: 'Data',
            defaultWidth: 110,
            render: (row) => row.criadoEm,
          },
        ]}
        rows={pageRows}
        loading={isFetching}
        page={safePage}
        pageSize={PAGE_SIZE}
        total={filtered.length}
        onPageChange={setPage}
        minWidth="min-w-[1100px]"
        emptyTitle="Nenhum assinante encontrado"
        emptyDescription="Esse link ainda não possui assinaturas ou nenhum resultado correspondeu aos filtros."
      />
    </div>
  );
}
