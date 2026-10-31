'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { useColumnResize } from '@/hooks/use-column-resize';

/** Checkbox com estado "indeterminado" (parcialmente selecionado). */
export function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current)
      ref.current.indeterminate = Boolean(indeterminate) && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      className="h-4 w-4 cursor-pointer accent-emerald-500"
    />
  );
}

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  defaultWidth?: number;
  /** Absorve a largura que sobrar depois das colunas fixas. */
  grow?: boolean;
};

type Props<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  minWidth?: string;
  /** Seleção em massa: mostra uma coluna de checkboxes (linha + "selecionar tudo"). */
  selectable?: boolean;
  getRowId?: (row: T) => string;
  selectedIds?: Set<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: () => void;
};

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-white/40 dark:border-white/10">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-5">
          <div className="flex justify-center">
            <div
              className="h-4 w-3/4 animate-pulse rounded-md bg-zinc-200/50 dark:bg-white/10"
              style={{ animationDuration: '2s' }}
            />
          </div>
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  emptyTitle = 'Nenhum resultado',
  emptyDescription = 'Tente ajustar os filtros e pesquisar novamente.',
  onRowClick,
  page,
  pageSize,
  total,
  onPageChange,
  minWidth = 'min-w-[800px]',
  selectable,
  getRowId,
  selectedIds,
  onToggleRow,
  onToggleAll,
}: Props<T>) {
  const totalPages = Math.max(1, Math.ceil((total ?? 0) / (pageSize || 1)));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const isEmpty = !loading && rows.length === 0;
  const { widths, onMouseDown } = useColumnResize(columns);

  const canSelect = Boolean(selectable && getRowId);
  const selectedCount = canSelect
    ? rows.filter((r) => selectedIds?.has(getRowId!(r))).length
    : 0;
  const allSelected =
    canSelect && rows.length > 0 && selectedCount === rows.length;
  const someSelected = canSelect && selectedCount > 0 && !allSelected;
  const extraCols = canSelect ? 1 : 0;
  const columnsWidth = columns.reduce(
    (total, column) =>
      total + (widths[column.key] ?? column.defaultWidth ?? 150),
    canSelect ? 48 : 0,
  );

  return (
    <div className="flex w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-2xl border border-white/40 bg-zinc-50/50 shadow-[0_12px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div
        className={`scrollbar-themed w-full min-w-0 max-w-full touch-pan-x overflow-auto overscroll-x-contain ${isEmpty ? '' : 'flex-1'}`}
      >
        <table
          className={`w-full ${minWidth}`}
          style={{
            tableLayout: 'fixed',
            minWidth: columnsWidth,
          }}
        >
          <colgroup>
            {canSelect && <col style={{ width: 48 }} />}
            {columns.map((c) => (
              <col
                key={c.key}
                style={c.grow ? undefined : { width: widths[c.key] ?? 150 }}
              />
            ))}
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-10 border-b border-white/40 bg-zinc-50/80 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950/80">
              {canSelect && (
                <th
                  style={{ width: 48 }}
                  className="px-3 py-4 text-center align-middle"
                >
                  <TriCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => onToggleAll?.()}
                    ariaLabel="Selecionar todos"
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    width: c.grow ? undefined : (widths[c.key] ?? 150),
                    position: 'relative',
                    userSelect: 'none',
                  }}
                  className={[
                    'px-4 py-4 text-center text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400',
                    c.headerClassName,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="block truncate" title={c.header}>
                    {c.header}
                  </span>
                  {/* resize handle */}
                  <span
                    onMouseDown={(e) => onMouseDown(c.key, e)}
                    className="absolute right-0 top-0 z-10 flex h-full w-3 cursor-col-resize items-center justify-center group/resize"
                    aria-hidden
                  >
                    <span className="h-4/5 w-px bg-zinc-300 dark:bg-zinc-600" />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/40 dark:divide-white/10">
            {loading ? (
              <>
                <SkeletonRow cols={columns.length + extraCols} />
                <SkeletonRow cols={columns.length + extraCols} />
                <SkeletonRow cols={columns.length + extraCols} />
              </>
            ) : rows.length ? (
              rows.map((row, idx) => (
                <tr
                  key={getRowId?.(row) ?? idx}
                  className={[
                    'group transition-colors',
                    canSelect && selectedIds?.has(getRowId!(row))
                      ? 'bg-emerald-500/5'
                      : '',
                    onRowClick
                      ? 'cursor-pointer hover:bg-zinc-950/5 dark:hover:bg-white/5'
                      : '',
                  ].join(' ')}
                  onClick={() => onRowClick?.(row)}
                >
                  {canSelect && (
                    <td
                      className="px-3 py-4 text-center align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <TriCheckbox
                        checked={selectedIds?.has(getRowId!(row)) ?? false}
                        onChange={() => onToggleRow?.(getRowId!(row))}
                        ariaLabel="Selecionar linha"
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={[
                        'px-4 py-4 text-center text-sm overflow-hidden text-ellipsis',
                        c.className,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Empty state fora da área de scroll horizontal: centraliza na largura visível,
          não na largura total da tabela (que pode passar de 2800px e jogava a mensagem
          pra fora da tela). */}
      {isEmpty && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {emptyTitle}
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {emptyDescription}
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/40 bg-zinc-50/50 px-6 py-4 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          Página{' '}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {page}
          </span>{' '}
          de{' '}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {totalPages}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => onPageChange(page - 1)}
            className={[
              'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all duration-200',
              canPrev
                ? 'border-zinc-200 bg-white text-zinc-700 hover:-translate-y-0.5 hover:bg-zinc-50 active:translate-y-0 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                : 'cursor-not-allowed border-zinc-100 text-zinc-300 dark:border-white/5 dark:text-zinc-600',
            ].join(' ')}
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => onPageChange(page + 1)}
            className={[
              'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all duration-200',
              canNext
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
