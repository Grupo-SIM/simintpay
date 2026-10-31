'use client';

import type { LucideIcon } from 'lucide-react';
import { HelpCircle } from 'lucide-react';
import { Tooltip as TooltipRadix } from 'radix-ui';
import { cn, isNegativeMoneyString } from '@/lib/utils';

type Props = {
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  /** Explicação rápida no tooltip (ícone ao lado do rótulo). */
  tooltip?: string;
  onAction?: () => void;
  actionIcon?: LucideIcon;
};

export function MetricCard({
  label,
  value,
  detail,
  valueClassName,
  icon: Icon,
  iconClassName,
  tooltip,
  onAction,
  actionIcon: ActionIcon,
}: Props) {
  const showHelp = Boolean(tooltip?.trim());

  return (
    // h-full + flex-col: o card ocupa toda a altura da célula do grid e o valor é empurrado
    // para o rodapé (mt-auto), então rótulos de 1 ou 2 linhas não deslocam o valor.
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-gray-300 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:shadow-none dark:hover:border-white/15 dark:hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {label}
            </p>
            {showHelp ? (
              <TooltipRadix.Root delayDuration={200}>
                <TooltipRadix.Trigger asChild>
                  <button
                    type="button"
                    aria-label={`O que é ${label}`}
                    className="inline-flex shrink-0 rounded-md p-0.5 text-zinc-400 transition-colors hover:bg-zinc-200/80 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                  >
                    <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </TooltipRadix.Trigger>
                <TooltipRadix.Portal>
                  <TooltipRadix.Content
                    side="top"
                    align="start"
                    sideOffset={8}
                    className={cn(
                      'z-[100] max-w-[min(280px,calc(100vw-2rem))] rounded-xl border border-white/10 px-3.5 py-2.5 text-left text-xs leading-relaxed shadow-xl',
                      'bg-zinc-900 text-zinc-100 dark:border-white/15 dark:bg-zinc-950',
                    )}
                  >
                    {tooltip?.trim() ? <p>{tooltip.trim()}</p> : null}
                  </TooltipRadix.Content>
                </TooltipRadix.Portal>
              </TooltipRadix.Root>
            ) : null}
            {onAction && ActionIcon ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction();
                }}
                className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <ActionIcon className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>
        {Icon ? (
          <div
            className={[
              'shrink-0 rounded-lg p-2.5 bg-zinc-100 dark:bg-zinc-800',
              iconClassName ?? '',
            ].join(' ')}
          >
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
      </div>

      <p
        className={cn(
          'mt-auto pt-3 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100',
          valueClassName,
          // Saldo/valor negativo sempre em vermelho (vence qualquer valueClassName).
          isNegativeMoneyString(value) && 'text-red-600 dark:text-red-400',
        )}
      >
        {value}
      </p>
      {detail && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {detail}
        </p>
      )}

      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-zinc-200 to-transparent opacity-0 transition-opacity group-hover:opacity-100 dark:via-zinc-800" />
    </div>
  );
}
