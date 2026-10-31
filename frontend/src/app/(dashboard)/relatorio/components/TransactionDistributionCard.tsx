'use client';

import type { LucideIcon } from 'lucide-react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TransacaoDistribuicaoItem } from '../types';

type Props = {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconClassName: string;
  items: TransacaoDistribuicaoItem[];
  loading?: boolean;
};

export function TransactionDistributionCard({
  title,
  subtitle,
  icon: Icon,
  iconClassName,
  items,
  loading,
}: Props) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/40 bg-white/70 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="border-b border-zinc-200/70 p-4 dark:border-white/10">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              iconClassName,
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {title}
            </h3>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <Clock className="h-3.5 w-3.5 shrink-0 opacity-80" />
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 pt-2">
        <div className="mb-2 grid grid-cols-[1fr_auto_140px] gap-2 border-b border-zinc-200/60 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-white/10 dark:text-zinc-400">
          <span>Nome</span>
          <span className="text-right tabular-nums">Quantidade</span>
          <span className="text-right">Percentual</span>
        </div>

        {loading ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_140px] gap-2 animate-pulse"
              >
                <div className="h-7 w-24 rounded-full bg-zinc-200/80 dark:bg-white/10" />
                <div className="h-5 w-8 justify-self-end rounded bg-zinc-200/80 dark:bg-white/10" />
                <div className="h-5 rounded bg-zinc-200/80 dark:bg-white/10" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Nenhuma transação no período.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((row) => (
              <li
                key={row.codigo}
                className="grid grid-cols-[1fr_auto_140px] items-center gap-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="inline-block max-w-full truncate rounded-full border border-zinc-200/90 bg-zinc-100/90 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:border-white/10 dark:bg-zinc-800/80 dark:text-zinc-200">
                    {row.nome}
                  </span>
                </span>
                <span className="tabular-nums text-right font-medium text-zinc-900 dark:text-zinc-100">
                  {row.quantidade}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700/80">
                    <div
                      className="h-full rounded-full bg-zinc-900 transition-[width] duration-500 dark:bg-zinc-100"
                      style={{ width: `${Math.min(100, row.percentual)}%` }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-xs font-medium tabular-nums text-zinc-600 dark:text-zinc-300">
                    {row.percentual.toLocaleString('pt-BR', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                    %
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
