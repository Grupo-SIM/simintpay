'use client';

import { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { Dropdown } from '@/components/ui/Dropdown';
import type { SubscriberRow } from '../types';
import { getPlatformBadgeClass } from '@/lib/utils';
import { formatBrl, getInitials } from '../utils';
import {
  SubscribersRowActionsMenu,
  type Action,
} from './SubscribersRowActionsMenu';
import { useColumnResize } from '@/hooks/use-column-resize';

type Props = {
  rows: SubscriberRow[];
  loading?: boolean;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  rowsPerPage: number;
  fieldTheme: 'light' | 'dark';
  columnVisibility: Record<string, boolean>;
  onFirstPage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onLastPage: () => void;
  canRemoveFromHistory: boolean;
  selectedRowIds: Set<string>;
  onToggleRowSelection: (rowId: string, checked: boolean) => void;
  onTogglePageSelection: (checked: boolean) => void;
  onRowAction?: (action: Action, rowId: string) => void;
};

function renderCell(column: string, row: SubscriberRow) {
  switch (column) {
    case 'Nome':
      return (
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-700/15 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
            aria-hidden
          >
            {getInitials(row.name)}
          </span>
          <span className="min-w-0 truncate font-medium">{row.name}</span>
        </div>
      );
    case 'Plataforma':
      const DISPLAY: Record<string, string> = {
        areaflix: 'Áreaflix',
        ebooksim: 'EbookSim',
        ebook: 'EbookSim',
        atlas: 'AtlasHosting',
        'controle-motorista': 'Controle de Motorista',
      };
      const platLabel =
        DISPLAY[row.plataforma?.toLowerCase()] ?? row.plataforma;
      return row.plataforma && row.plataforma !== '—' ? (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase whitespace-nowrap ${getPlatformBadgeClass(row.plataforma)}`}
        >
          {platLabel}
        </span>
      ) : (
        <span className="text-zinc-400 dark:text-zinc-600">—</span>
      );
    case 'Descrição':
      return (
        <span className="text-zinc-600 dark:text-zinc-400">
          {row.description}
        </span>
      );
    case 'Intervalo':
      return (
        <span className="text-sm">
          {row.intervalText}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            {row.intervalUnit}
          </span>
        </span>
      );
    case 'Valor':
      return <span className="tabular-nums">{formatBrl(row.valueBrl)}</span>;
    case 'Ativo':
      return row.active ? (
        <span className="font-medium text-emerald-600 dark:text-emerald-400">
          Sim
        </span>
      ) : (
        <span className="font-medium text-red-600 dark:text-red-400">Não</span>
      );
    case 'Primeira cobrança':
      return <span className="tabular-nums">{row.firstCharge}</span>;
    case 'Próxima cobrança':
      return <span className="tabular-nums">{row.nextCharge}</span>;
    default:
      return null;
  }
}

export function SubscribersTable({
  loading = false,
  rows,
  currentPage,
  totalPages,
  hasNextPage,
  rowsPerPage,
  fieldTheme,
  columnVisibility,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
  canRemoveFromHistory,
  selectedRowIds,
  onToggleRowSelection,
  onTogglePageSelection,
  onRowAction,
}: Props) {
  const visibleColumns = Object.entries(columnVisibility)
    .filter(([, visible]) => visible)
    .map(([key]) => key);

  const colDefs = useMemo(
    () => [
      { key: '__selecionar__', defaultWidth: 44 },
      ...visibleColumns.map((col) => ({ key: col, defaultWidth: 160 })),
      { key: '__acoes__', defaultWidth: 80 },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleColumns],
  );
  const { widths, onMouseDown } = useColumnResize(colDefs);
  const totalWidth = colDefs.reduce(
    (s, c) => s + (widths[c.key] ?? c.defaultWidth),
    0,
  );
  const allRowsSelected =
    rows.length > 0 && rows.every((row) => selectedRowIds.has(row.id));

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/40 bg-zinc-50/50 shadow-[0_12px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <ScrollArea className="flex-1">
        <table
          style={{
            tableLayout: 'fixed',
            width: `${totalWidth}px`,
            minWidth: '100%',
          }}
        >
          <colgroup>
            {colDefs.map((c) => (
              <col
                key={c.key}
                style={{ width: widths[c.key] ?? c.defaultWidth }}
              />
            ))}
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-10 border-b border-white/40 bg-zinc-50/80 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950/80">
              <th
                className="px-3 py-3 text-center"
                aria-label="Selecionar assinantes"
              >
                <input
                  type="checkbox"
                  checked={allRowsSelected}
                  onChange={(event) =>
                    onTogglePageSelection(event.target.checked)
                  }
                  className="h-4 w-4 cursor-pointer accent-emerald-600"
                />
              </th>
              {visibleColumns.map((col) => (
                <th
                  key={col}
                  style={{
                    position: 'relative',
                    userSelect: 'none',
                    width: widths[col],
                  }}
                  className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500"
                >
                  {col}
                  <span
                    onMouseDown={(e) => onMouseDown(col, e)}
                    className="absolute right-0 top-0 flex h-full w-3 cursor-col-resize items-center justify-center"
                    aria-hidden
                  >
                    <span className="h-4/5 w-px bg-zinc-300 dark:bg-zinc-600" />
                  </span>
                </th>
              ))}
              <th
                style={{
                  position: 'relative',
                  userSelect: 'none',
                  width: widths['__acoes__'],
                }}
                className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500"
              >
                Ações
                <span
                  onMouseDown={(e) => onMouseDown('__acoes__', e)}
                  className="absolute right-0 top-0 flex h-full w-3 cursor-col-resize items-center justify-center"
                  aria-hidden
                >
                  <span className="h-4/5 w-px bg-zinc-300 dark:bg-zinc-600" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/40 dark:divide-white/10">
            {loading &&
              Array.from({ length: 8 }, (_, index) => (
                <tr key={`loading-${index}`} aria-hidden>
                  {Array.from(
                    { length: visibleColumns.length + 2 },
                    (_, cell) => (
                      <td key={cell} className="px-4 py-4">
                        <div className="h-5 animate-pulse rounded bg-zinc-200 dark:bg-white/10" />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length + 2}
                  className="p-8 text-center text-sm text-zinc-500"
                >
                  Nenhum assinante encontrado.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-zinc-950/5 dark:hover:bg-white/5"
                >
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedRowIds.has(row.id)}
                      onChange={(event) =>
                        onToggleRowSelection(row.id, event.target.checked)
                      }
                      aria-label={`Selecionar ${row.name}`}
                      className="h-4 w-4 cursor-pointer accent-emerald-600"
                    />
                  </td>
                  {visibleColumns.map((col) => (
                    <td
                      key={col}
                      className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300 overflow-hidden text-ellipsis"
                    >
                      {renderCell(col, row)}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                    <SubscribersRowActionsMenu
                      rowId={row.id}
                      isPaused={row.isPaused}
                      isActive={row.active}
                      canRemoveFromHistory={
                        canRemoveFromHistory &&
                        Boolean(row.deactivated) &&
                        !row.isPaused
                      }
                      fieldTheme={fieldTheme}
                      onAction={onRowAction}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </ScrollArea>
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
            disabled={currentPage === 1}
            onClick={onPrevPage}
            className={[
              'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all duration-200',
              currentPage > 1
                ? 'border-zinc-200 bg-white text-zinc-700 hover:-translate-y-0.5 hover:bg-zinc-50 active:translate-y-0 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                : 'cursor-not-allowed border-zinc-100 text-zinc-300 dark:border-white/5 dark:text-zinc-600',
            ].join(' ')}
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={!hasNextPage}
            onClick={onNextPage}
            className={[
              'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all duration-200',
              hasNextPage
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
