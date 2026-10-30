'use client';
import { useState } from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { ReportSkeleton } from './ReportSkeleton';
import { ReportError } from './ReportError';
import { ReportPagination } from './ReportPagination';
import { PlatformBalanceDetail } from './PlatformBalanceDetail';
import {
  reportMoney,
  type PlatformBalance,
  type ReportPage,
} from './report-types';

export function PlatformBalancesView() {
  const api = useReportApi();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useReportQuery({
    queryKey: ['platform-balances', page],
    queryFn: ({ signal }) =>
      api.get<ReportPage<PlatformBalance>>(
        '/admin/relatorios/saldos-plataformas',
        { query: { page, pageSize: 12 }, signal },
      ),
  });
  if (query.isPending) return <ReportSkeleton />;
  if (query.isError) return <ReportError retry={() => void query.refetch()} />;
  const detail = query.data.data.find((b) => b.id === selected);
  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-semibold">Saldos atribuídos por plataforma</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Disponível projetado por produto, separado da carteira do dono.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {query.data.data.map((b) => (
          <button
            type="button"
            key={b.id}
            onClick={() => setSelected(b.id)}
            className="cursor-pointer space-y-3 rounded-2xl border border-violet-500/30 p-4 text-left transition-colors hover:bg-violet-500/5"
          >
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-violet-500" />
              <span className="flex-1 text-sm font-semibold">
                {b.name}
                {!b.isActive && ' (Inativa)'}
              </span>
              <ChevronRight className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Disponível projetado</p>
              <p className="text-2xl font-bold tabular-nums text-emerald-600">
                {reportMoney(b.availableBalanceCents)}
              </p>
            </div>
            <p className="text-xs">
              Saldo atribuído: {reportMoney(b.balanceCents)}
            </p>
            <p className="text-xs text-zinc-500">
              Reservas: {reportMoney(b.pendingWithdrawalsGrossCents)}
            </p>
            <p className="text-xs text-zinc-500">
              {b.owner.name}
              {b.walletScope === 'shared-owner' && ' · Carteira compartilhada'}
            </p>
            {!b.historicalAttributionComplete && (
              <p className="text-xs text-amber-600">Histórico incompleto</p>
            )}
          </button>
        ))}
      </div>
      {query.data.total === 0 && (
        <p className="text-sm text-zinc-500">Nenhuma plataforma cadastrada.</p>
      )}
      <ReportPagination
        page={page}
        total={query.data.total}
        pageSize={12}
        onChange={(next) => {
          setSelected(null);
          setPage(next);
        }}
      />
      {detail && (
        <PlatformBalanceDetail
          balance={detail}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
