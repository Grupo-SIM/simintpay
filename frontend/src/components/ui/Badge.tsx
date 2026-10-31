import type { ReactNode } from 'react';

type Variant =
  | 'COMPLETED'
  | 'APPROVED'
  | 'PENDING'
  | 'FAILED'
  | 'REJECTED'
  | 'REFUNDED'
  | 'DEFAULT';

function getVariant(value: string): Variant {
  const v = value?.toUpperCase?.() ?? '';
  if (
    v === 'COMPLETED' ||
    v === 'APPROVED' ||
    v === 'APROVADO' ||
    v === 'APROVADA' ||
    v === 'PAGO'
  )
    return 'APPROVED';
  if (v === 'PENDING' || v === 'PENDENTE') return 'PENDING';
  if (
    v === 'FAILED' ||
    v === 'REJECTED' ||
    v === 'REJEITADO' ||
    v === 'RECUSADO' ||
    v === 'RECUSADA' ||
    v === 'FALHA'
  )
    return 'REJECTED';
  if (v === 'REFUNDED' || v === 'ESTORNADA' || v === 'ESTORNADO')
    return 'REFUNDED';
  return 'DEFAULT';
}

function getClasses(variant: Variant) {
  if (variant === 'APPROVED') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400';
  }
  if (variant === 'PENDING') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400';
  }
  if (variant === 'REJECTED') {
    return 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400';
  }
  if (variant === 'REFUNDED') {
    return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400';
  }
  return 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400';
}

export function Badge({
  value,
  children,
}: {
  value?: string;
  children?: ReactNode;
}) {
  const variant = getVariant(
    value ?? (typeof children === 'string' ? children : ''),
  );

  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
        getClasses(variant),
      ].join(' ')}
    >
      {children ?? value}
    </span>
  );
}
