'use client';

import { useMemo } from 'react';
import { useReportQuery as useQuery } from '@/hooks/use-report-api';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { formatBRL } from '@/lib/utils';
import { ReportError } from './ReportError';
import { ReportSkeleton } from './ReportSkeleton';

type PlatformBalance = {
  id: string;
  tag: string;
  name: string;
  isActive: boolean;
  owner: { id: string; name: string; email?: string };
  earnedCents: number;
  withdrawnGrossCents: number;
  pendingWithdrawalsGrossCents: number;
  balanceCents: number;
  availableBalanceCents: number;
  ownerWalletBalanceCents: number;
  walletScope: 'owner' | 'shared-owner' | 'merchant-platform';
};
type BalancePage = {
  data: PlatformBalance[];
  total: number;
  pageSize: number;
};
type Person = {
  id: string;
  name: string;
  email?: string;
  walletCents: number;
  platforms: PlatformBalance[];
};

const PAGE_SIZE = 100;
const money = (cents: number) => formatBRL(cents / 100);

export function groupByPerson(rows: PlatformBalance[]): Person[] {
  const people = new Map<string, Person>();
  for (const row of rows) {
    const person = people.get(row.owner.id) ?? {
      ...row.owner,
      walletCents: row.ownerWalletBalanceCents,
      platforms: [],
    };
    person.platforms.push(row);
    people.set(row.owner.id, person);
  }
  return [...people.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR'),
  );
}

export default function PeopleBillingReport() {
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      }),
    [],
  );
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['people-billing'],
    queryFn: async () => {
      const rows: PlatformBalance[] = [];
      for (let page = 1; ; page++) {
        const result = await api.get<BalancePage>(
          '/admin/relatorios/saldos-plataformas',
          { query: { page, pageSize: PAGE_SIZE } },
        );
        rows.push(...result.data);
        if (result.data.length === 0 || page * PAGE_SIZE >= result.total) break;
      }
      return groupByPerson(rows);
    },
  });

  if (isLoading) return <ReportSkeleton />;
  if (isError || !data) return <ReportError retry={() => void refetch()} />;
  if (!data.length)
    return (
      <p className="text-sm text-zinc-500">Nenhuma plataforma cadastrada.</p>
    );

  const totalWallet = data.reduce((sum, p) => sum + p.walletCents, 0);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4">
        <p className="text-sm text-zinc-500">
          Saldo total em carteiras ({data.length} pessoas)
        </p>
        <p className="text-2xl font-bold">{money(totalWallet)}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            <tr>
              <th className="p-3">Pessoa / Plataforma</th>
              <th className="p-3 text-right">Faturado</th>
              <th className="p-3 text-right">Sacado</th>
              <th className="p-3 text-right">Saque pendente</th>
              <th className="p-3 text-right">Saldo</th>
              <th className="p-3 text-right">Disponível</th>
            </tr>
          </thead>
          <tbody>
            {data.map((person) => (
              <PersonRows key={person.id} person={person} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        O saldo da carteira é único por pessoa e compartilhado entre suas
        plataformas; o saldo por plataforma é a projeção das vendas
        identificadas menos os saques dela.
      </p>
    </div>
  );
}

function PersonRows({ person }: { person: Person }) {
  return (
    <>
      <tr className="border-t bg-zinc-50/60 font-semibold dark:bg-zinc-900/60">
        <td className="p-3" colSpan={4}>
          {person.name}
          {person.email && (
            <span className="ml-2 font-normal text-zinc-500">
              {person.email}
            </span>
          )}
        </td>
        <td className="p-3 text-right" colSpan={2}>
          Carteira: {money(person.walletCents)}
        </td>
      </tr>
      {person.platforms.map((p) => (
        <tr key={p.id} className="border-t">
          <td className="p-3 pl-8">
            {p.name}
            {!p.isActive && <span className="ml-2 text-zinc-400">inativa</span>}
          </td>
          <td className="p-3 text-right">{money(p.earnedCents)}</td>
          <td className="p-3 text-right">{money(p.withdrawnGrossCents)}</td>
          <td className="p-3 text-right">
            {money(p.pendingWithdrawalsGrossCents)}
          </td>
          <td className="p-3 text-right">{money(p.balanceCents)}</td>
          <td className="p-3 text-right">{money(p.availableBalanceCents)}</td>
        </tr>
      ))}
    </>
  );
}
