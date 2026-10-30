'use client';

import { Tooltip } from 'radix-ui';
import type { ReactNode } from 'react';
import { BarChart2, Wallet } from 'lucide-react';

export function ReportsLayout({
  activeTab,
  onTabChange,
  admin = false,
  children,
}: {
  activeTab: string;
  onTabChange: (tab: 'relatorios' | 'produtos' | 'saldos') => void;
  admin?: boolean;
  children: ReactNode;
}) {
  const tabs = [
    {
      id: 'relatorios' as const,
      label: 'Relatório Financeiro',
      icon: BarChart2,
    },
    ...(admin
      ? [
          {
            id: 'saldos' as const,
            label: 'Saldos por Plataforma',
            icon: Wallet,
          },
        ]
      : []),
  ];
  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="flex h-full min-h-0 flex-col gap-6 p-1 font-sans">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Relatórios Financeiros
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {admin
              ? 'Acompanhe o desempenho e as movimentações da sua conta em tempo real.'
              : 'Movimentações das plataformas das quais você é dono.'}
          </p>
        </div>
        {admin && (
          <div
            role="tablist"
            aria-label="Relatórios"
            className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-white/10"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => onTabChange(id)}
                className={`-mb-px flex cursor-pointer items-center gap-2 border-b-2 px-5 py-2.5 text-sm font-semibold transition-colors ${activeTab === id ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-400' : 'border-zinc-200 text-zinc-500 hover:text-zinc-800 dark:border-white/10 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        )}
        {children}
      </div>
    </Tooltip.Provider>
  );
}
