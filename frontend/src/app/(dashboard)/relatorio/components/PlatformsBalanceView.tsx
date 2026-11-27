'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useReportApi } from '@/hooks/use-report-api';
import { useInfiniteSentinel } from '@/hooks/use-infinite-sentinel';
import { Modal } from '@/components/ui/Modal';
import { BalanceTotalCards } from './BalanceTotalCards';
import { ReportError } from './ReportError';
import { ReportPagination } from './ReportPagination';
import { ReportSkeleton } from './ReportSkeleton';
import { BalanceCard, type WalletBucket } from './PlatformBalanceCard';
import { CACHE_MS, PAGE_SIZE, type BalanceViewProps } from './UsersBalanceView';

type PlatformTotal = WalletBucket & { usersCount: number };
type PlatformPage = {
  data: PlatformTotal[];
  total: number;
  page: number;
  pageSize: number;
};
type PlatformUsers = {
  data: { id: string; name: string; email: string; bucket: WalletBucket }[];
  total: number;
  page: number;
  pageSize: number;
};

const withdrawal = (bucket: WalletBucket) =>
  bucket.periodWithdrawnCents + bucket.pendingWithdrawalsCents;
const usersLabel = (count: number) =>
  `${count} ${count === 1 ? 'usuário' : 'usuários'}`;
const BASE = '/admin/relatorios/saldos-por-plataforma';

/** One card per platform (summed over every user); the modal lists each user's balance in it. */
export function PlatformsBalanceView({
  scope,
  startDate,
  endDate,
  term,
}: BalanceViewProps) {
  const api = useReportApi();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [usersPage, setUsersPage] = useState(1);
  const list = useInfiniteQuery({
    queryKey: [...scope, 'platforms', startDate, endDate, term],
    staleTime: CACHE_MS,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      api.get<PlatformPage>(BASE, {
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
  const platforms = list.data?.pages.flatMap((page) => page.data) ?? [];
  const selected = platforms.find((item) => item.key === selectedKey) ?? null;
  const users = useQuery({
    queryKey: [
      ...scope,
      'platform-users',
      selectedKey,
      startDate,
      endDate,
      usersPage,
    ],
    enabled: !!selectedKey,
    staleTime: CACHE_MS,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.get<PlatformUsers>(`${BASE}/${encodeURIComponent(selectedKey!)}`, {
        query: { startDate, endDate, page: usersPage, pageSize: PAGE_SIZE },
        signal,
      }),
  });

  if (list.isPending) return <ReportSkeleton />;
  if (list.isError) return <ReportError retry={() => void list.refetch()} />;
  if (!platforms.length)
    return <p className="text-sm text-zinc-500">Nenhum saldo encontrado.</p>;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {platforms.map((platform) => (
          <BalanceCard
            key={platform.key}
            title={platform.name}
            subtitle={usersLabel(platform.usersCount)}
            availableCents={platform.availableCents}
            billedCents={platform.periodReceivedCents}
            withdrawalCents={withdrawal(platform)}
            onClick={() => {
              setUsersPage(1);
              setSelectedKey(platform.key);
            }}
          />
        ))}
      </div>
      <div ref={sentinel} className="h-1" />
      {list.isFetchingNextPage && <ReportSkeleton />}
      <Modal
        open={!!selected}
        title={selected ? `Usuários em ${selected.name}` : undefined}
        maxWidth="max-w-4xl"
        onClose={() => setSelectedKey(null)}
      >
        {selected && (
          <div className="space-y-4">
            <BalanceTotalCards
              totals={{
                availableCents: selected.availableCents,
                receivedCents: selected.periodReceivedCents,
                withdrawnCents: selected.periodWithdrawnCents,
                pendingWithdrawalsCents: selected.pendingWithdrawalsCents,
              }}
            />
            {users.isPending ? (
              <ReportSkeleton />
            ) : users.isError ? (
              <ReportError retry={() => void users.refetch()} />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {users.data.data.map((row) => (
                    <BalanceCard
                      key={row.id}
                      title={row.name}
                      subtitle={row.email}
                      availableCents={row.bucket.availableCents}
                      billedCents={row.bucket.periodReceivedCents}
                      withdrawalCents={withdrawal(row.bucket)}
                    />
                  ))}
                </div>
                <ReportPagination
                  page={usersPage}
                  total={users.data.total}
                  pageSize={PAGE_SIZE}
                  onChange={setUsersPage}
                />
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
