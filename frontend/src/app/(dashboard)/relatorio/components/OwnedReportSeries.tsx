'use client';
import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { ReportResultsTable } from './ReportResultsTable';
import { ReportError } from './ReportError';
import { ReportSkeleton } from './ReportSkeleton';
import { reportMethod, reportStatus, type ReportSeries } from './report-types';

export function OwnedReportSeries({
  filters,
  kind,
  admin = false,
}: {
  admin?: boolean;
  filters: Record<string, string | undefined>;
  kind: 'mensal' | 'status' | 'metodos';
}) {
  const api = useReportApi();
  const query = useReportQuery({
    queryKey: ['series', kind, filters],
    queryFn: ({ signal }) =>
      api.get<ReportSeries>(`/relatorios/financeiro/${kind}`, {
        query: filters,
        signal,
      }),
  });
  if (query.isPending) return <ReportSkeleton />;
  if (query.isError) return <ReportError retry={() => void query.refetch()} />;
  const title =
    kind === 'mensal'
      ? 'Resultados mensais'
      : kind === 'status'
        ? 'Vendas por status'
        : 'Vendas por método';
  return (
    <ReportResultsTable
      title={title}
      admin={admin}
      label={
        kind === 'mensal' ? 'Mês' : kind === 'status' ? 'Status' : 'Método'
      }
      monthly={kind === 'mensal'}
      rows={[...query.data.data]
        .sort((a, b) => (kind === 'mensal' ? b.key.localeCompare(a.key) : 0))
        .map((row) => ({
          key: row.key,
          label:
            kind === 'status'
              ? (reportStatus[row.key] ?? row.key)
              : kind === 'metodos'
                ? (reportMethod[row.key] ?? row.key)
                : row.key,
          count: row.count,
          gross: row.grossCents / 100,
          net: row.netCents / 100,
          fees: row.feesCents == null ? null : row.feesCents / 100,
          interest: row.interestCents == null ? null : row.interestCents / 100,
        }))}
    />
  );
}
