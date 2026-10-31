import type { ComponentType, ReactNode } from 'react';

export function InfoRow({
  label,
  value,
  right,
  icon: Icon,
}: {
  label: string;
  value?: string | null;
  right?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-start justify-between gap-3 group">
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <div className="mt-0.5 p-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-500 dark:text-zinc-400">
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
            {label}
          </div>
          <div className="mt-1 break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {value || '-'}
          </div>
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}
