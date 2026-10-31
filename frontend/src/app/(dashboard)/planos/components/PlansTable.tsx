'use client';

import { PlatformBadges } from '@/components/ui/PlatformBadges';
import { useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink } from 'lucide-react';
import type { PlanRow } from '../types';
import { PlansRowActionsMenu } from './PlansRowActionsMenu';
import { useColumnResize } from '@/hooks/use-column-resize';
import { TriCheckbox } from '@/components/ui/DataTable';

function CpfDonoCell({ row }: { row: PlanRow }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  if (!row.cpfDono) return <span className="text-zinc-400">—</span>;

  const showAbove = rect ? rect.bottom + 80 > window.innerHeight : false;
  const tooltipStyle: React.CSSProperties = rect
    ? showAbove
      ? {
          position: 'fixed',
          left: rect.left + rect.width / 2,
          top: rect.top - 6,
          transform: 'translateX(-50%) translateY(-100%)',
          zIndex: 9999,
        }
      : {
          position: 'fixed',
          left: rect.left + rect.width / 2,
          top: rect.bottom + 6,
          transform: 'translateX(-50%)',
          zIndex: 9999,
        }
    : {};

  return (
    <span
      ref={ref}
      className="cursor-default font-mono text-xs text-zinc-600 dark:text-zinc-300"
      onMouseEnter={() => setRect(ref.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={() => setRect(null)}
    >
      {row.cpfDono}
      {rect &&
        (row.donoNome || row.donoEmail) &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none max-w-xs rounded-xl border border-white/20 bg-zinc-900/95 px-3 py-2 shadow-xl backdrop-blur-md dark:bg-zinc-800/95"
            style={tooltipStyle}
          >
            {row.donoNome && (
              <p className="text-xs font-semibold text-zinc-100">
                {row.donoNome}
              </p>
            )}
            {row.donoEmail && (
              <p className="mt-0.5 text-xs text-zinc-400">{row.donoEmail}</p>
            )}
            <p className="mt-0.5 text-xs font-mono text-zinc-500">
              {row.cpfDono}
            </p>
          </div>,
          document.body,
        )}
    </span>
  );
}
type Action = 'editar' | 'desativar' | 'ativar' | 'excluir';

type Props = {
  rows: PlanRow[];
  currentPage: number;
  totalPages: number;
  rowsPerPage: number;
  fieldTheme: 'light' | 'dark';
  columnVisibility: Record<string, boolean>;
  onFirstPage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onLastPage: () => void;
  onRowAction?: (action: Action, rowId: string) => void;
  selectedIds?: Set<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: () => void;
};

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [url]);
  return (
    <button
      type="button"
      title={copied ? 'Copiado!' : 'Copiar link'}
      onClick={copy}
      className={
        copied
          ? 'text-emerald-500 transition-colors'
          : 'text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200'
      }
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0" />
      )}
    </button>
  );
}

function renderCell(column: string, row: PlanRow) {
  switch (column) {
    case 'Id':
      return row.id;
    case 'Nome do plano':
      return row.name;
    case 'Plataforma': {
      const tags =
        row.plataformas.length > 0
          ? row.plataformas
          : row.plataforma
            ? [row.plataforma]
            : [];
      return <PlatformBadges platforms={tags} />;
    }
    case 'Link de pagamento':
      return (
        <span className="inline-flex items-center gap-2">
          <a
            href={row.paymentLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-500 hover:underline dark:text-emerald-400"
            title="Abrir checkout"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
          <CopyLinkButton url={row.paymentLink} />
        </span>
      );
    case 'Intervalo':
      return row.interval;
    case 'Forma de pagamento':
      return row.paymentMethod;
    case 'Status':
      return row.status === 'Inativo' ? (
        <span className="text-amber-500 dark:text-amber-400">{row.status}</span>
      ) : (
        <span className="text-emerald-700 dark:text-emerald-300">
          {row.status}
        </span>
      );
    case 'Assinaturas':
      return (
        <>
          <div>{row.activeSubs} ativa</div>
          <div>{row.inactiveSubs} inativas</div>
        </>
      );
    case 'Data de criação':
      return row.createdAt;
    case 'Criado por':
      return (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-zinc-700 dark:text-zinc-200">
            {row.donoNome ?? '—'}
          </span>
          {row.donoEmail && (
            <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
              {row.donoEmail}
            </span>
          )}
        </div>
      );
    case 'CPF Dono':
      return <CpfDonoCell row={row} />;
    default:
      return null;
  }
}

export function PlansTable({
  rows,
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
  fieldTheme,
  columnVisibility,
  onRowAction,
  selectedIds,
  onToggleRow,
  onToggleAll,
}: Props) {
  const visibleColumns = Object.entries(columnVisibility)
    .filter(([, visible]) => visible)
    .map(([key]) => key);

  const canSelect = Boolean(onToggleRow && onToggleAll);
  const selectedCount = canSelect
    ? rows.filter((r) => selectedIds?.has(r.id)).length
    : 0;
  const allSelected =
    canSelect && rows.length > 0 && selectedCount === rows.length;
  const someSelected = canSelect && selectedCount > 0 && !allSelected;

  const colDefs = useMemo(
    () => [
      ...(canSelect ? [{ key: '__select__', defaultWidth: 48 }] : []),
      ...visibleColumns.map((col) => ({ key: col, defaultWidth: 160 })),
      { key: '__acoes__', defaultWidth: 80 },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleColumns, canSelect],
  );

  const { widths, onMouseDown } = useColumnResize(colDefs);
  const totalWidth = colDefs.reduce(
    (s, c) => s + (widths[c.key] ?? c.defaultWidth),
    0,
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/40 bg-zinc-50/50 shadow-[0_12px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="flex-1 overflow-auto">
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
              {canSelect && (
                <th
                  style={{ width: widths['__select__'] ?? 48 }}
                  className="px-3 py-3 text-center align-middle"
                >
                  <TriCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => onToggleAll?.()}
                    ariaLabel="Selecionar todos"
                  />
                </th>
              )}
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
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`transition-colors hover:bg-zinc-950/5 dark:hover:bg-white/5 ${canSelect && selectedIds?.has(row.id) ? 'bg-emerald-500/5' : ''}`}
              >
                {canSelect && (
                  <td className="px-3 py-3 text-center align-middle">
                    <TriCheckbox
                      checked={selectedIds?.has(row.id) ?? false}
                      onChange={() => onToggleRow?.(row.id)}
                      ariaLabel="Selecionar linha"
                    />
                  </td>
                )}
                {visibleColumns.map((col) => (
                  <td
                    key={col}
                    className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300 overflow-hidden text-ellipsis"
                  >
                    {renderCell(col, row)}
                  </td>
                ))}
                <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <PlansRowActionsMenu
                    rowId={row.id}
                    isActive={row.isActive}
                    fieldTheme={fieldTheme}
                    onAction={onRowAction}
                  />
                </td>
              </tr>
            ))}
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
            disabled={currentPage === totalPages}
            onClick={onNextPage}
            className={[
              'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all duration-200',
              currentPage < totalPages
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
