'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useReportApi } from '@/hooks/use-report-api';
import type { DateRange } from '../types';
import { BalanceTotalCards, type BalanceTotals } from './BalanceTotalCards';
import { DateRangePickerField } from './DateRangePickerField';
import { PlatformsBalanceView } from './PlatformsBalanceView';
import { CACHE_MS, UsersBalanceView } from './UsersBalanceView';

const ymd = (date: Date | null) =>
  date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : undefined;
const currentPeriod = (): DateRange => {
  const now = new Date();
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
};
const VIEWS = [
  ['plataformas', 'Plataformas'],
  ['usuarios', 'Usuários'],
] as const;

export default function PeopleBillingReport({ admin }: { admin: boolean }) {
  const api = useReportApi();
  const { user } = useCurrentUser();
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [range, setRange] = useState<DateRange>(currentPeriod);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  // The view toggle lives in the URL (?visao=usuarios) next to the tab (?aba=saldos); platforms is the admin default.
  const view =
    admin && params.get('visao') !== 'usuarios' ? 'plataformas' : 'usuarios';
  const setView = (next: (typeof VIEWS)[number][0]) => {
    const query = new URLSearchParams(params.toString());
    if (next === 'usuarios') query.set('visao', next);
    else query.delete('visao');
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };
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
      api.get<BalanceTotals>(
        `${admin ? '/admin/relatorios/saldos-carteiras' : '/relatorios/saldos-carteira'}/resumo`,
        { signal },
      ),
  });
  const viewProps = {
    admin,
    scope,
    startDate: ymd(range.start),
    endDate: ymd(range.end),
    term,
  };
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
          <>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                view === 'plataformas' ? 'Buscar plataforma' : 'Buscar usuário'
              }
              className="h-10 rounded-lg border bg-transparent px-3 text-sm"
            />
            <div
              role="group"
              aria-label="Visão"
              className="flex h-10 rounded-lg border p-1"
            >
              {VIEWS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => setView(key)}
                  className={`cursor-pointer rounded-md px-3 text-sm font-medium ${view === key ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        O filtro de período é aplicado sobre os valores faturados e sacados
      </p>
      {view === 'plataformas' ? (
        <PlatformsBalanceView key="plataformas" {...viewProps} />
      ) : (
        <UsersBalanceView key="usuarios" {...viewProps} />
      )}
    </div>
  );
}
