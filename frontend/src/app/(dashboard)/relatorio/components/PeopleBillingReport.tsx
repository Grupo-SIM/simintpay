'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useReportApi } from '@/hooks/use-report-api';
import { Modal } from '@/components/ui/Modal';
import type { DateRange } from '../types';
import { BalanceTotalCards, type BalanceTotals } from './BalanceTotalCards';
import { DateRangePickerField } from './DateRangePickerField';
import { ReportError } from './ReportError';
import { ReportSkeleton } from './ReportSkeleton';
import {
  money,
  PlatformBalanceCard,
  Stat,
  type WalletBucket,
} from './PlatformBalanceCard';

type Person = {
  id: string;
  name: string;
  email: string;
  balanceCents: number;
  lockedCents: number;
  availableCents: number;
  totals: BalanceTotals;
  platforms: WalletBucket[];
};
type BalancePage = {
  data: Person[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 12;
const CACHE_MS = 60_000;
const ymd = (date: Date | null) =>
  date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : undefined;
const currentPeriod = (): DateRange => {
  const now = new Date();
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
};
const sum = (rows: WalletBucket[], pick: (row: WalletBucket) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

export default function PeopleBillingReport({ admin }: { admin: boolean }) {
  const api = useReportApi();
  const { user } = useCurrentUser();
  const { resolvedTheme } = useTheme();
  const [range, setRange] = useState<DateRange>(currentPeriod);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const startDate = ymd(range.start);
  const endDate = ymd(range.end);
  const base = admin
    ? '/admin/relatorios/saldos-carteiras'
    : '/relatorios/saldos-carteira';
  const scope = ['people-billing', user?.id, admin ? 'admin' : 'owner'];

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const totals = useQuery({
    queryKey: [...scope, 'totals'],
    enabled: !!user,
    staleTime: CACHE_MS,
    queryFn: ({ signal }) =>
      api.get<BalanceTotals>(`${base}/resumo`, { signal }),
  });
  const list = useInfiniteQuery({
    queryKey: [...scope, 'list', startDate, endDate, term],
    enabled: !!user,
    staleTime: CACHE_MS,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      api.get<BalancePage>(base, {
        query: {
          page: pageParam,
          pageSize: PAGE_SIZE,
          startDate,
          endDate,
          search: term || undefined,
        },
        signal,
      }),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage)
        void fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const people = list.data?.pages.flatMap((page) => page.data) ?? [];
  // Always read the person from the current (period-filtered) list, never from a copy taken on click.
  const selected = people.find((person) => person.id === selectedId) ?? null;
  return (
    <div className="space-y-4">
      {totals.data && <BalanceTotalCards totals={totals.data} />}
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePickerField
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          label="Período"
          value={range}
          onChange={setRange}
        />
        {admin && (
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar usuário"
            className="h-10 rounded-lg border bg-transparent px-3 text-sm"
          />
        )}
      </div>
      <p className="text-xs text-zinc-500">
        O filtro de período é aplicado sobre os valores faturados e sacados
      </p>
      {list.isPending ? (
        <ReportSkeleton />
      ) : list.isError ? (
        <ReportError retry={() => void list.refetch()} />
      ) : !people.length ? (
        <p className="text-sm text-zinc-500">Nenhum saldo encontrado.</p>
      ) : admin ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => setSelectedId(person.id)}
              className="flex cursor-pointer flex-col justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-gray-300 hover:shadow-md dark:border-white/10 dark:bg-white/5"
            >
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{person.name}</h3>
                <p className="truncate text-xs text-zinc-500">{person.email}</p>
              </div>
              <dl className="flex flex-col gap-2">
                <div>
                  <dt className="text-xs text-zinc-500">
                    Saldo disponível para saque
                  </dt>
                  <dd className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {money(person.availableCents)}
                  </dd>
                </div>
                <Stat
                  label="Faturado"
                  value={money(
                    sum(person.platforms, (p) => p.periodReceivedCents),
                  )}
                />
                <Stat
                  label="Sacado"
                  value={money(
                    sum(person.platforms, (p) => p.periodWithdrawnCents),
                  )}
                />
                <Stat
                  label="Saque pendente"
                  value={money(person.totals.pendingWithdrawalsCents)}
                />
              </dl>
            </button>
          ))}
        </div>
      ) : (
        <PlatformGrid platforms={people[0].platforms} />
      )}
      <div ref={sentinel} className="h-1" />
      {isFetchingNextPage && <ReportSkeleton />}
      <Modal
        open={!!selected}
        title={selected ? `Plataformas de ${selected.name}` : undefined}
        maxWidth="max-w-4xl"
        onClose={() => setSelectedId(null)}
      >
        {selected && (
          <div className="space-y-4">
            <BalanceTotalCards
              totals={{
                availableCents: selected.availableCents,
                receivedCents: sum(
                  selected.platforms,
                  (p) => p.periodReceivedCents,
                ),
                withdrawnCents: sum(
                  selected.platforms,
                  (p) => p.periodWithdrawnCents,
                ),
                pendingWithdrawalsCents:
                  selected.totals.pendingWithdrawalsCents,
              }}
            />
            <PlatformGrid platforms={selected.platforms} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function PlatformGrid({ platforms }: { platforms: WalletBucket[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {platforms.map((bucket) => (
        <PlatformBalanceCard key={bucket.key} bucket={bucket} />
      ))}
    </div>
  );
}
