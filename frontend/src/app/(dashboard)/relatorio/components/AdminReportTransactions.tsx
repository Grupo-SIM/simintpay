'use client';

import { useState } from 'react';
import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { endpoints } from '@/services/api/endpoints';
import { ReportError } from './ReportError';
import { ReportSkeleton } from './ReportSkeleton';
import { ReportTransactionsTable } from './ReportTransactionsTable';
import { type ReportPage } from './report-types';

type Transaction = {
  id: string;
  plataformaTag: string | null;
  valor: number;
  valorLiquido: number | null;
  status: string;
  metodo: string;
  descricao: string | null;
  criadoEm: string;
  cliente: { nome: string | null };
  taxas: { total: number };
};

export function AdminReportTransactions({
  startDate,
  endDate,
  method = 'all',
}: {
  startDate?: string;
  endDate?: string;
  method?: string;
}) {
  const api = useReportApi();
  const [page, setPage] = useState(1);
  const query = useReportQuery({
    queryKey: ['consolidated-transactions', startDate, endDate, method, page],
    queryFn: ({ signal }) =>
      api.get<ReportPage<Transaction>>(
        endpoints.relatorios.consolidadoTransacoes,
        {
          query: {
            dataInicio: startDate,
            dataFim: endDate,
            metodoPagamento: method === 'all' ? undefined : method,
            page,
            pageSize: 20,
          },
          signal,
        },
      ),
  });
  if (query.isPending) return <ReportSkeleton />;
  if (query.isError) return <ReportError retry={() => void query.refetch()} />;
  return (
    <ReportTransactionsTable
      rows={query.data.data.map((row) => ({
        id: row.id,
        createdAt: row.criadoEm,
        platformTag: row.plataformaTag,
        description: row.descricao,
        customerName: row.cliente.nome,
        status: row.status,
        paymentMethod: row.metodo,
        gross: row.valor,
        fees: row.taxas.total,
        net: row.valorLiquido,
      }))}
      total={query.data.total}
      page={page}
      onPageChange={setPage}
    />
  );
}
