'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useReportApi } from '@/hooks/use-report-api';
import { useInfiniteSentinel } from '@/hooks/use-infinite-sentinel';
import { Modal } from '@/components/ui/Modal';
import { BalanceTotalCards, type BalanceTotals } from './BalanceTotalCards';
import { ReportError } from './ReportError';
import { ReportSkeleton } from './ReportSkeleton';
import {
  BalanceCard,
  PlatformBalanceCard,
  type WalletBucket,
} from './PlatformBalanceCard';

type Person = {
  id: string;
  name: string;
  email: string;
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
export type BalanceViewProps = {
  admin: boolean;
  scope: (string | undefined)[];
  startDate?: string;
  endDate?: string;
  term: string;
};

export const PAGE_SIZE = 12;
export const CACHE_MS = 60_000;
export const sum = (
  rows: WalletBucket[],
  pick: (row: WalletBucket) => number,
) => rows.reduce((total, row) => total + pick(row), 0);

/** One card per user; admins open a modal with that user's platform cards. */
export function UsersBalanceView({
  admin,
  scope,
  startDate,
  endDate,
  term,
}: BalanceViewProps) {
  const api = useReportApi();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const base = admin
    ? '/admin/relatorios/saldos-carteiras'
    : '/relatorios/saldos-carteira';
  const list = useInfiniteQuery({
    queryKey: [...scope, 'users', startDate, endDate, term],
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
  const sentinel = useInfiniteSentinel(
    list.hasNextPage,
    list.isFetchingNextPage,
    list.fetchNextPage,
  );
  const people = list.data?.pages.flatMap((page) => page.data) ?? [];
  // Read the person from the current (period-filtered) list, never from a copy taken on click.
  const selected = people.find((person) => person.id === selectedId) ?? null;

  if (list.isPending) return <ReportSkeleton />;
  if (list.isError) return <ReportError retry={() => void list.refetch()} />;
  if (!people.length)
    return <p className="text-sm text-zinc-500">Nenhum saldo encontrado.</p>;
  return (
    <>
      {admin ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((person) => (
            <BalanceCard
              key={person.id}
              title={person.name}
              subtitle={person.email}
              availableCents={person.availableCents}
              billedCents={sum(person.platforms, (p) => p.periodReceivedCents)}
              withdrawalCents={
                sum(person.platforms, (p) => p.periodWithdrawnCents) +
                person.totals.pendingWithdrawalsCents
              }
              onClick={() => setSelectedId(person.id)}
            />
          ))}
        </div>
      ) : (
        <PlatformGrid platforms={people[0].platforms} />
      )}
      <div ref={sentinel} className="h-1" />
      {list.isFetchingNextPage && <ReportSkeleton />}
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
    </>
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
