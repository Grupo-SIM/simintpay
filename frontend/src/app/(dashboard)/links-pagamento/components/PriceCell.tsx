'use client';

import { useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Converte texto digitado (ex: "49,90" ou "49.90") para número em reais. */
function parseValor(raw: string): number | null {
  const cleaned = raw
    .replace(/[^\d.,]/g, '')
    .replace(/\.(?=.*[.,])/g, '')
    .replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

type Props = {
  value: number;
  saving?: boolean;
  onSave: (valor: number) => void;
};

export function PriceCell({ value, saving, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleConfirm() {
    const parsed = parseValor(draft);
    if (parsed === null) {
      inputRef.current?.focus();
      return;
    }
    if (parsed !== value) {
      onSave(parsed);
    }
    setEditing(false);
  }

  function handleCancel() {
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="group inline-flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {formatBRL(value)}
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft(value.toFixed(2).replace('.', ','));
            setEditing(true);
          }}
          aria-label="Editar preço"
          className="rounded-md p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-950/10 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-200"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <div className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-2 dark:border-white/15 dark:bg-white/5">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">R$</span>
        <input
          ref={(input) => {
            inputRef.current = input;
            input?.select();
          }}
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm();
            if (e.key === 'Escape') handleCancel();
          }}
          className="w-20 bg-transparent px-1 py-1 text-sm text-zinc-900 outline-none dark:text-zinc-100"
        />
      </div>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={saving}
        aria-label="Confirmar"
        className="rounded-md p-1 text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleCancel}
        disabled={saving}
        aria-label="Cancelar"
        className="rounded-md p-1 text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
