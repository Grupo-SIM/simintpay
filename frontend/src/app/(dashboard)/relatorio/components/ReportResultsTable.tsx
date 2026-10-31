import type { ReactNode } from 'react';
import { cn, formatBRL, negativeMoneyClass } from '@/lib/utils';
import { ReportDataTable } from './ReportDataTable';

export type ReportResultRow = {
  key: string;
  label: string;
  count?: number;
  gross: number;
  net: number;
  acquirerFees?: number;
  profit?: number;
  fees?: number | null;
  interest?: number | null;
};

type Props = {
  title: string;
  label: string;
  rows: ReportResultRow[];
  monthly?: boolean;
  admin?: boolean;
  loading?: boolean;
  controls?: ReactNode;
};

export function ReportResultsTable({
  title,
  label,
  rows,
  monthly = false,
  admin = false,
  loading = false,
  controls,
}: Props) {
  const internal = admin && monthly;
  const columns = [
    { label },
    { label: 'Vendas', numeric: true },
    { label: 'Valor bruto', numeric: true },
    ...(internal ? [{ label: 'Taxas das adquirentes', numeric: true }] : []),
    ...(!admin && monthly
      ? [
          { label: 'Taxas', numeric: true },
          { label: 'Juros', numeric: true },
        ]
      : []),
    { label: admin ? 'Total repassado' : 'Lucro bruto', numeric: true },
    ...(internal ? [{ label: 'Lucro líquido', numeric: true }] : []),
  ];
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return (
    <ReportDataTable
      title={title}
      columns={columns}
      monthly={monthly}
      controls={controls}
      empty={!loading && rows.length === 0}
    >
      {loading ? (
        <tr>
          <td colSpan={columns.length}>
            <div
              className="h-32 animate-pulse rounded-lg bg-zinc-100 dark:bg-white/5"
              aria-label="Carregando resultados"
            />
          </td>
        </tr>
      ) : (
        rows.map((row) => (
          <tr
            key={row.key}
            className={cn(
              'transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.025]',
              monthly &&
                row.key === currentMonth &&
                'bg-violet-50/60 dark:bg-violet-950/20',
            )}
          >
            <td className="whitespace-nowrap text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {row.label}
              {monthly && row.key === currentMonth && (
                <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                  atual
                </span>
              )}
            </td>
            <td className="text-right tabular-nums">{row.count ?? '—'}</td>
            <td className="whitespace-nowrap text-right tabular-nums">
              {formatBRL(row.gross)}
            </td>
            {internal && (
              <td className="whitespace-nowrap text-right tabular-nums text-rose-600 dark:text-rose-400">
                {row.acquirerFees == null ? '—' : formatBRL(row.acquirerFees)}
              </td>
            )}
            {!admin && monthly && (
              <>
                <td className="whitespace-nowrap text-right tabular-nums text-rose-600 dark:text-rose-400">
                  {row.fees == null ? 'Não informado' : formatBRL(row.fees)}
                </td>
                <td className="whitespace-nowrap text-right tabular-nums text-amber-600 dark:text-amber-400">
                  {formatBRL(row.interest ?? 0)}
                </td>
              </>
            )}
            <td
              title={!admin ? 'Antes da taxa de saque' : undefined}
              className="whitespace-nowrap text-right font-semibold tabular-nums"
            >
              {formatBRL(row.net)}
            </td>
            {internal && (
              <td
                className={cn(
                  'whitespace-nowrap text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400',
                  negativeMoneyClass(row.profit),
                )}
              >
                {row.profit == null ? '—' : formatBRL(row.profit)}
              </td>
            )}
          </tr>
        ))
      )}
    </ReportDataTable>
  );
}
