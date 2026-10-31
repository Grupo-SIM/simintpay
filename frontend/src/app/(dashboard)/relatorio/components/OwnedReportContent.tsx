'use client';
import { useEffect } from 'react';
import { ApiError } from '@/services/api/types';
import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { ReportError } from './ReportError';
import { ReportSkeleton } from './ReportSkeleton';
import { ReportSummaryCards } from './ReportSummaryCards';
import { OwnedReportTransactions } from './OwnedReportTransactions';
import { OwnedReportSeries } from './OwnedReportSeries';
import { OwnedReportProfitChart } from './OwnedReportProfitChart';
import type { ReportSummary } from './report-types';

export function OwnedReportContent({
  filters,
  product = false,
  onAccessLost,
}: {
  filters: Record<string, string | undefined>;
  product?: boolean;
  onAccessLost?: () => void;
}) {
  const api = useReportApi();
  const query = useReportQuery({
    queryKey: ['summary', filters, product],
    queryFn: ({ signal }) =>
      api.get<ReportSummary>(
        product
          ? `/relatorios/plataformas/${encodeURIComponent(filters.platform!)}/produto`
          : '/relatorios/financeiro',
        { query: filters, signal },
      ),
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 403)
      onAccessLost?.();
  }, [query.error, onAccessLost]);
  if (query.isPending) return <ReportSkeleton />;
  if (query.isError) return <ReportError retry={() => void query.refetch()} />;
  if (!query.data.platformsCount)
    return (
      <p className="rounded-xl border p-6 text-sm">
        Nenhuma plataforma própria disponível para relatório.
      </p>
    );
  return (
    <div className="space-y-6">
      <ReportSummaryCards data={query.data} />
      {!product && <OwnedReportProfitChart filters={filters} />}
      <OwnedReportSeries filters={filters} kind="mensal" />
      <div className="grid gap-4 xl:grid-cols-2">
        <OwnedReportSeries filters={filters} kind="metodos" />
        <OwnedReportSeries filters={filters} kind="status" />
      </div>
      <OwnedReportTransactions
        key={JSON.stringify(filters)}
        filters={filters}
        product={product}
      />
    </div>
  );
}
