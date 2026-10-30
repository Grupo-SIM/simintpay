'use client';

import { Trash2 } from 'lucide-react';

/** Barra de ações em massa: aparece quando há itens selecionados na listagem. */
export function BulkActionsBar({
  count,
  onDelete,
  onClear,
  deleting,
}: {
  count: number;
  onDelete: () => void;
  onClear: () => void;
  deleting?: boolean;
}) {
  if (count === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-50 px-4 py-2.5 dark:bg-emerald-500/10">
      <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
        {count} selecionado{count === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
        >
          Limpar seleção
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? 'Excluindo…' : 'Excluir selecionados'}
        </button>
      </div>
    </div>
  );
}
