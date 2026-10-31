import type { ReportRow } from '../types';

type Props = {
  theme: 'light' | 'dark';
  rows: ReportRow[];
  isFetching: boolean;
  selectedDataColumns: Record<string, boolean>;
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
};

export function ReportTable({
  theme,
  rows,
  isFetching,
  selectedDataColumns,
  totalPages,
  currentPage,
  onPageChange,
}: Props) {
  const columns = [
    {
      key: 'Data da transação',
      label: 'Data de emissão',
      accessor: (row: ReportRow) => row.issueDate,
    },
    {
      key: 'Data de liquidação',
      label: 'Data de liquidação',
      accessor: (row: ReportRow) => row.settlementDate,
    },
    {
      key: 'Cliente',
      label: 'Cliente',
      accessor: (row: ReportRow) => row.customer,
    },
    {
      key: 'ID da transação',
      label: 'ID da transação',
      accessor: (row: ReportRow) => row.transactionId,
    },
    { key: 'Tipo', label: 'Tipo', accessor: (row: ReportRow) => row.type },
    {
      key: 'Método de pagamento',
      label: 'Método de pagamento',
      accessor: (row: ReportRow) => row.paymentLink,
    },
    { key: 'Operação', label: 'Operação', accessor: (row: ReportRow) => '-' },
    {
      key: 'Operador',
      label: 'Operador',
      accessor: (row: ReportRow) => row.operator,
    },
    {
      key: 'Link de pagamento',
      label: 'Link de pagamento',
      accessor: (row: ReportRow) => row.paymentLink,
    },
    {
      key: 'Plano de assinatura',
      label: 'Plano de assinatura',
      accessor: (row: ReportRow) => row.planName,
    },
    {
      key: 'Valor bruto',
      label: 'Valor bruto',
      accessor: (row: ReportRow) => row.gross,
    },
    {
      key: 'Taxas',
      label: 'Taxa',
      accessor: (row: ReportRow) => row.fee,
      className: 'text-amber-600 dark:text-amber-300',
    },
    {
      key: 'Valor estornado',
      label: 'Valor estornado',
      accessor: (row: ReportRow) => row.reversed,
    },
    {
      key: 'Valor repassado',
      label: 'Valor repassado',
      accessor: (row: ReportRow) => row.net,
      className: 'text-zinc-900 dark:text-zinc-100 font-semibold',
    },
  ];

  const visibleColumns = columns.filter((col) => selectedDataColumns[col.key]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/40 bg-zinc-50/50 shadow-[0_12px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-white/40 bg-zinc-50/80 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950/80">
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/40 dark:divide-white/10">
            {isFetching ? (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  Carregando dados...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  Nenhuma transação encontrada.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={`${row.transactionId}-${idx}`}
                  className="transition-colors hover:bg-zinc-950/5 dark:hover:bg-white/5"
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300 ${col.className || ''}`}
                    >
                      {col.accessor(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/40 bg-zinc-50/50 px-6 py-4 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          Página{' '}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {currentPage}
          </span>{' '}
          de{' '}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {totalPages}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={currentPage === 1 || isFetching}
            onClick={() => onPageChange(currentPage - 1)}
            className={[
              'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all duration-200',
              currentPage > 1 && !isFetching
                ? 'border-zinc-200 bg-white text-zinc-700 hover:-translate-y-0.5 hover:bg-zinc-50 active:translate-y-0 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                : 'cursor-not-allowed border-zinc-100 text-zinc-300 dark:border-white/5 dark:text-zinc-600',
            ].join(' ')}
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={currentPage >= totalPages || isFetching}
            onClick={() => onPageChange(currentPage + 1)}
            className={[
              'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all duration-200',
              currentPage < totalPages && !isFetching
                ? 'border-zinc-200 bg-white text-zinc-700 hover:-translate-y-0.5 hover:bg-zinc-50 active:translate-y-0 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                : 'cursor-not-allowed border-zinc-100 text-zinc-300 dark:border-white/5 dark:text-zinc-600',
            ].join(' ')}
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
