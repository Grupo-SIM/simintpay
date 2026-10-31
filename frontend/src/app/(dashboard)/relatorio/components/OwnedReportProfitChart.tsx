'use client';

import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { buildOwnedProfitChart } from '../utils/owned-profit-chart';
import { LucroSimpayPlataformaBarCard } from './LucroSimpayPlataformaBarCard';
import { ReportError } from './ReportError';
import type { ReportPage, ReportTransaction } from './report-types';

export function OwnedReportProfitChart({
  filters,
}: {
  filters: Record<string, string | undefined>;
}) {
  const api = useReportApi();
  const start = filters.startDate;
  const end = filters.endDate;
  const query = useReportQuery({
    queryKey: ['owner-profit-chart', filters],
    enabled: !!start && !!end,
    queryFn: async ({ signal }) => {
      if (!start || !end) throw new Error('Período incompleto');
      const transactions: ReportTransaction[] = [];
      const ids = new Set<string>();
      let page = 1;
      let total: number;
      do {
        const result = await api.get<ReportPage<ReportTransaction>>(
          '/relatorios/financeiro/transacoes',
          {
            query: { ...filters, page, pageSize: 100 },
            signal,
          },
        );
        if (result.page !== page || result.data.some((row) => ids.has(row.id)))
          throw new Error('Paginação inconsistente do relatório');
        for (const row of result.data) ids.add(row.id);
        transactions.push(...result.data);
        total = result.total;
        if (transactions.length < total && result.data.length === 0)
          throw new Error('Paginação incompleta do relatório');
        page++;
      } while (transactions.length < total);
      return {
        ...buildOwnedProfitChart(transactions, start, end),
        hasSales: transactions.some((row) => row.status === 'COMPLETED'),
      };
    },
  });
  if (!start || !end)
    return (
      <p className="rounded-xl border p-6 text-sm">
        Selecione um período para visualizar o lucro por plataforma.
      </p>
    );
  if (query.isError) return <ReportError retry={() => void query.refetch()} />;
  return (
    <section aria-label="Lucro bruto por plataforma" className="space-y-2">
      <LucroSimpayPlataformaBarCard
        title="Lucro bruto por plataforma"
        subtitle={`Período filtrado (${start} a ${end}) · antes da taxa de saque.`}
        series={query.data}
        ymdStart={start}
        ymdEnd={end}
        loading={query.isPending}
        hasTransactionsInPeriod={query.data?.hasSales}
      />
      {query.data && query.data.missing > 0 && (
        <p role="status" className="text-sm text-amber-600">
          Histórico incompleto: vendas sem líquido registrado não foram
          incluídas no gráfico.
        </p>
      )}
    </section>
  );
}
