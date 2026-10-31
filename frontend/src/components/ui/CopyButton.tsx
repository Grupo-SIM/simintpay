'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

type Props = {
  value: string;
  label?: string;
  className?: string;
  size?: number | string;
  iconOnly?: boolean;
};

export function CopyButton({
  value,
  label = 'Copiar',
  className,
  size,
  iconOnly = false,
}: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      style={size ? { width: size, height: size } : undefined}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 transition-all active:scale-95 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10',
        !iconOnly ? 'px-3 py-2' : 'p-2',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-600" />
      ) : (
        <Copy className="h-4 w-4 opacity-60" />
      )}
      {!iconOnly && <span>{copied ? 'Copiado' : label}</span>}
    </button>
  );
}
