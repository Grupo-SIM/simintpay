'use client';
import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { ReportMovementSections } from './ReportMovementSections';
import { ReportSkeleton } from './ReportSkeleton';
import { ReportError } from './ReportError';
import type { ReportSummary } from './report-types';

export function AdminReportMovements({
  filters,
}: {
  filters: Record<string, string | undefined>;
}) {
  const api = useReportApi();
  const query = useReportQuery({
    queryKey: ['summary', filters, false],
    queryFn: ({ signal }) =>
      api.get<ReportSummary>('/relatorios/financeiro', {
        query: filters,
        signal,
      }),
  });
  if (query.isPending) return <ReportSkeleton />;
  if (query.isError) return <ReportError retry={() => void query.refetch()} />;
  return <ReportMovementSections summary={query.data.summary} />;
}
