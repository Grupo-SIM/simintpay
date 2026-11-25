'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { ArrowDownLeft, ArrowUpRight, Eraser } from 'lucide-react';

import { cn, negativeMoneyClass } from '@/lib/utils';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Loading';
import { DateRangePickerField } from '../relatorio/components/DateRangePickerField';
import {
  normalizeDateFilterRange,
  parseDateRangeFromYmd,
  resolveYmdDateFilter,
  toLocalYmd,
} from '@/features/saques/utils/date-filter';
import { formatBRL } from '@/features/saques/utils/saques-format';
import { useExtrato } from '@/features/extrato/hooks/use-extrato';
import type {
  ExtratoEntry,
  ExtratoNatureza,
} from '@/features/extrato/types/extrato.types';
import {
  EXTRATO_PAGE_SIZE,
  NATUREZA_OPTIONS,
  entryTitle,
  formatDateTime,
  naturezaLabel,
} from '@/features/extrato/utils/extrato-format';

const CARD =
  'rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5';

function ExtratoContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const tipo = searchParams.get('tipo') ?? 'all';
  const natureza = searchParams.get('natureza') ?? 'all';
  const busca = searchParams.get('busca') ?? '';
  const page = Number(searchParams.get('page') ?? 1) || 1;
  const { dataInicio, dataFim } = resolveYmdDateFilter(
    searchParams.get('dataInicio') || undefined,
    searchParams.get('dataFim') || undefined,
  );
  const dateRange = parseDateRangeFromYmd(dataInicio, dataFim);

  const updateUrl = useCallback(
    (params: Record<string, string | number | Date | null | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(params).forEach(([key, value]) => {
        if (value instanceof Date) next.set(key, toLocalYmd(value));
        else if (value != null && value !== '') next.set(key, String(value));
        else next.delete(key);
      });
      if (Object.keys(params).some((key) => key !== 'page'))
        next.delete('page');
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const [searchText, updateSearch] = useDebouncedInput(busca, (value) =>
    updateUrl({ busca: value.trim() || null }),
  );

  const { data, isPending } = useExtrato({
    page,
    pageSize: EXTRATO_PAGE_SIZE,
    dataInicio,
    dataFim,
    tipo: tipo === 'ENTRADA' || tipo === 'SAIDA' ? tipo : undefined,
    natureza: natureza === 'all' ? undefined : (natureza as ExtratoNatureza),
    busca: busca || undefined,
  });

  const columns = useMemo(
    () => [
      {
        key: 'criadoEm',
        header: 'Data',
        render: (row: ExtratoEntry) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatDateTime(row.criadoEm)}
          </span>
        ),
      },
      {
        key: 'descricao',
        header: 'Descrição',
        grow: true,
        render: (row: ExtratoEntry) => (
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {entryTitle(row)}
          </span>
        ),
      },
      {
        key: 'natureza',
        header: 'Natureza',
        render: (row: ExtratoEntry) => (
          <Badge value="default">{naturezaLabel(row.natureza)}</Badge>
        ),
      },
      {
        key: 'valor',
        header: 'Valor',
        render: (row: ExtratoEntry) => (
          <span
            className={cn(
              'font-semibold',
              row.valor > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : negativeMoneyClass(row.valor),
            )}
          >
            {row.valor > 0 ? '+' : ''}
            {formatBRL(row.valor)}
          </span>
        ),
      },
      {
        key: 'valorBloqueado',
        header: 'Em processamento',
        render: (row: ExtratoEntry) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {row.valorBloqueado === 0
              ? '-'
              : `${row.valorBloqueado > 0 ? '+' : ''}${formatBRL(row.valorBloqueado)}`}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Extrato</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Histórico de alterações do seu saldo
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={CARD}>
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-emerald-100 p-3 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-500">
              <ArrowUpRight className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Entradas no filtro
              </p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatBRL(data?.resumo.entradas)}
              </p>
            </div>
          </div>
        </div>
        <div className={CARD}>
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-red-100 p-3 text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <ArrowDownLeft className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Saídas no filtro
              </p>
              <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                {formatBRL(data?.resumo.saidas)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className={cn(CARD, 'relative z-30')}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DateRangePickerField
            label="Data inicial e final:"
            value={dateRange}
            onChange={(next) => {
              const { start, end } = normalizeDateFilterRange(
                next.start,
                next.end,
              );
              updateUrl({ dataInicio: start, dataFim: end });
            }}
            theme={fieldTheme}
          />
          <Dropdown
            label="Tipo:"
            value={tipo}
            onChange={(v) => updateUrl({ tipo: v !== 'all' ? v : null })}
            theme={fieldTheme}
            variant="navbar"
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'ENTRADA', label: 'Entradas' },
              { value: 'SAIDA', label: 'Saídas' },
            ]}
          />
          <Dropdown
            label="Natureza:"
            value={natureza}
            onChange={(v) => updateUrl({ natureza: v !== 'all' ? v : null })}
            theme={fieldTheme}
            variant="navbar"
            options={[{ value: 'all', label: 'Todas' }, ...NATUREZA_OPTIONS]}
          />
          <Input
            label="Descrição:"
            placeholder="Buscar"
            value={searchText}
            onChange={updateSearch}
            theme={fieldTheme}
            variant="navbar"
          />
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => router.push(pathname)}
            className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
          >
            <Eraser className="h-4 w-4" />
            Limpar filtros
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        loading={isPending}
        page={data?.page ?? page}
        pageSize={EXTRATO_PAGE_SIZE}
        total={data?.total ?? 0}
        onPageChange={(p) => updateUrl({ page: p })}
        emptyTitle="Nenhum lançamento"
        minWidth="min-w-[900px]"
      />
    </div>
  );
}

export default function ExtratoPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center">
          <Spinner size={40} />
        </div>
      }
    >
      <ExtratoContent />
    </Suspense>
  );
}
