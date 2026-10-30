'use client';
import { useState } from 'react';
import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { ReportTransactionsTable } from './ReportTransactionsTable';
import { ReportError } from './ReportError';
import { ReportSkeleton } from './ReportSkeleton';
import { type ReportPage, type ReportTransaction } from './report-types';

export function OwnedReportTransactions({
  filters,
  product = false,
}: {
  filters: Record<string, string | undefined>;
  product?: boolean;
}) {
  const api = useReportApi();
  const [page, setPage] = useState(1);
  const query = useReportQuery({
    queryKey: ['transactions', filters, page, product],
    queryFn: ({ signal }) =>
      api.get<ReportPage<ReportTransaction>>(
        product
          ? `/relatorios/plataformas/${encodeURIComponent(filters.platform!)}/produto/transacoes`
          : '/relatorios/financeiro/transacoes',
        { query: { ...filters, page, pageSize: 20 }, signal },
      ),
  });
  if (query.isPending) return <ReportSkeleton />;
  if (query.isError) return <ReportError retry={() => void query.refetch()} />;
  return (
    <ReportTransactionsTable
      rows={query.data.data.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        platformTag: row.platformTag,
        description: row.description,
        customerName: row.customerName,
        status: row.status,
        paymentMethod: row.paymentMethod,
        gross: row.grossCents / 100,
        fees: row.feesCents / 100,
        net: row.netCents === null ? null : row.netCents / 100,
      }))}
      total={query.data.total}
      page={page}
      onPageChange={setPage}
    />
  );
}
