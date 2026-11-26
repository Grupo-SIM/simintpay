'use client';

import { useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { Modal } from '@/components/ui/Modal';
import type { DateRange } from '../types';
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
  platforms: WalletBucket[];
};
type BalancePage = { data: Person[]; total: number; pageSize: number };

const PAGE_SIZE = 100;
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
  const { resolvedTheme } = useTheme();
  const [range, setRange] = useState<DateRange>(currentPeriod);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Person | null>(null);
  const startDate = ymd(range.start);
  const endDate = ymd(range.end);
  const { data, isLoading, isError, refetch } = useReportQuery({
    queryKey: ['people-billing', admin, startDate, endDate],
    queryFn: async () => {
      const rows: Person[] = [];
      for (let page = 1; ; page++) {
        const result = await api.get<BalancePage>(
          admin
            ? '/admin/relatorios/saldos-carteiras'
            : '/relatorios/saldos-carteira',
          { query: { page, pageSize: PAGE_SIZE, startDate, endDate } },
        );
        rows.push(...result.data);
        if (result.data.length === 0 || page * PAGE_SIZE >= result.total) break;
      }
      return rows;
    },
  });
  const people = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter(
      (person) =>
        !term ||
        `${person.name} ${person.email ?? ''}`.toLowerCase().includes(term),
    );
  }, [data, search]);

  return (
    <div className="space-y-4">
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
            placeholder="Buscar pessoa"
            className="h-10 rounded-lg border bg-transparent px-3 text-sm"
          />
        )}
      </div>
      <p className="text-xs text-zinc-500">
        O período filtra faturado e sacado; saldo e disponível são sempre os
        valores atuais. Ganhos de afiliado e margem aparecem em SimIntPay; o que
        não tem plataforma de origem fica em Não identificado.
      </p>
      {isLoading ? (
        <ReportSkeleton />
      ) : isError || !data ? (
        <ReportError retry={() => void refetch()} />
      ) : !people.length ? (
        <p className="text-sm text-zinc-500">Nenhum saldo encontrado.</p>
      ) : admin ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => setSelected(person)}
              className="flex cursor-pointer flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-gray-300 hover:shadow-md dark:border-white/10 dark:bg-white/5"
            >
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{person.name}</h3>
                {person.email && (
                  <p className="truncate text-xs text-zinc-500">
                    {person.email}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-zinc-500">Carteira</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {money(person.balanceCents)}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3">
                <Stat
                  label="Recebido"
                  value={money(
                    sum(person.platforms, (p) => p.periodReceivedCents),
                  )}
                />
                <Stat
                  label="Plataformas"
                  value={String(person.platforms.length)}
                />
              </dl>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="rounded-2xl border p-5">
            <p className="text-xs text-zinc-500">Saldo da sua carteira</p>
            <p className="text-2xl font-bold">
              {money(people[0].balanceCents)}
            </p>
          </div>
          <PlatformGrid platforms={people[0].platforms} />
        </>
      )}
      <Modal
        open={!!selected}
        title={selected ? `Plataformas de ${selected.name}` : undefined}
        maxWidth="max-w-4xl"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">
              Carteira: {money(selected.balanceCents)} · Disponível:{' '}
              {money(selected.availableCents)}
            </p>
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
