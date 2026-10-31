import { formatBRL, formatTransacaoDescricaoUi } from '@/lib/utils';
import { ReportDataTable } from './ReportDataTable';
import { ReportPagination } from './ReportPagination';
import { reportMethod, reportStatus } from './report-types';

export type ReportTransactionRow = {
  id: string;
  createdAt: string;
  platformTag: string | null;
  description?: string | null;
  customerName?: string | null;
  status: string;
  paymentMethod: string;
  gross: number;
  fees: number;
  net: number | null;
};

type Props = {
  rows: ReportTransactionRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
};

export function ReportTransactionsTable({
  rows,
  total,
  page,
  onPageChange,
}: Props) {
  return (
    <ReportDataTable
      title="Vendas"
      columns={[
        ...[
          'Data',
          'Plataforma',
          'Descrição / cliente',
          'Status',
          'Método',
        ].map((label) => ({ label })),
        ...['Bruto', 'Taxas', 'Líquido'].map((label) => ({
          label,
          numeric: true,
        })),
      ]}
      summary={`${total.toLocaleString('pt-BR')} ${total === 1 ? 'venda' : 'vendas'}`}
      empty={rows.length === 0}
      emptyMessage="Nenhuma venda no período. Ajuste os filtros para consultar outras vendas."
      footer={
        <ReportPagination
          page={page}
          total={total}
          pageSize={20}
          onChange={onPageChange}
        />
      }
    >
      {rows.map((row) => {
        const approved = [
          'COMPLETED',
          'APPROVED',
          'APROVADA',
          'APROVADO',
        ].includes(row.status);
        const pending = ['PENDING', 'PENDENTE', 'DRAFT'].includes(row.status);
        const status = approved
          ? 'Aprovada'
          : (reportStatus[row.status] ??
            (
              {
                PENDENTE: 'Pendente',
                RECUSADA: 'Recusada',
                CANCELADA: 'Cancelada',
                ESTORNADA: 'Estornada',
              } as Record<string, string>
            )[row.status] ??
            'Não identificado');
        return (
          <tr
            key={row.id}
            className="transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.025]"
          >
            <td className="whitespace-nowrap px-5 py-4 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {new Date(row.createdAt).toLocaleDateString('pt-BR')}
            </td>
            <td className="px-5 py-4">
              <span className="inline-flex whitespace-nowrap rounded-md border border-zinc-200 bg-zinc-100 dark:border-white/10 dark:bg-white/5 px-2 py-1 text-xs font-medium">
                {row.platformTag ?? 'Não identificada'}
              </span>
            </td>
            <td className="max-w-[300px] px-5 py-4">
              <div
                className="truncate font-medium"
                title={formatTransacaoDescricaoUi(row.description ?? row.id)}
              >
                {formatTransacaoDescricaoUi(row.description ?? row.id)}
              </div>
              <div
                className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400"
                title={row.customerName ?? undefined}
              >
                {row.customerName ?? '—'}
              </div>
            </td>
            <td className="px-5 py-4">
              <span
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-xs ${approved ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-700 dark:text-emerald-400' : pending ? 'border-amber-400/20 bg-amber-400/10 text-amber-700 dark:text-amber-400' : 'border-zinc-200 bg-zinc-100 dark:border-white/10 dark:bg-white/5 text-zinc-600 dark:text-zinc-300'}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {status}
              </span>
            </td>
            <td className="whitespace-nowrap px-5 py-4 text-xs text-zinc-600 dark:text-zinc-300">
              {reportMethod[row.paymentMethod] ?? row.paymentMethod}
            </td>
            <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
              {formatBRL(row.gross)}
            </td>
            <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
              {formatBRL(row.fees)}
            </td>
            <td className="whitespace-nowrap px-5 py-4 text-right font-semibold tabular-nums">
              {row.net === null ? (
                <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  Não identificado
                </span>
              ) : (
                formatBRL(row.net)
              )}
            </td>
          </tr>
        );
      })}
    </ReportDataTable>
  );
}
