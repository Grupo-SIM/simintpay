import type { ReactNode } from 'react';
import { BarChart2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/ScrollArea';

export type ReportDataTableColumn = { label: string; numeric?: boolean };

type Props = {
  title: string;
  columns: ReportDataTableColumn[];
  children: ReactNode;
  empty?: boolean;
  emptyMessage?: string;
  summary?: ReactNode;
  controls?: ReactNode;
  footer?: ReactNode;
  monthly?: boolean;
};

export function ReportDataTable({
  title,
  columns,
  children,
  empty,
  emptyMessage = 'Nenhum movimento no período.',
  summary,
  controls,
  footer,
  monthly = false,
}: Props) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/80 shadow-sm dark:border-white/10 dark:bg-white/[0.025]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/70 px-5 py-4 dark:border-white/10">
        <div className="flex items-center gap-3">
          {monthly && (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
              <BarChart2 className="h-4 w-4" />
            </span>
          )}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {summary && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {summary}
          </span>
        )}
        {controls}
      </div>
      <ScrollArea>
        <table className="w-full text-left text-sm [&_td]:px-5 [&_td]:py-4">
          <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-white/[0.025] dark:text-zinc-400">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={`whitespace-nowrap px-5 py-3 font-medium ${column.numeric ? 'text-right' : ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {empty ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="h-32 text-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </ScrollArea>
      {footer && (
        <div className="border-t border-zinc-200/70 px-5 py-4 dark:border-white/10">
          {footer}
        </div>
      )}
    </section>
  );
}
