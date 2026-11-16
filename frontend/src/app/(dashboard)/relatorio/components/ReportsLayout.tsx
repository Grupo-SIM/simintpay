'use client';

import { Tooltip } from 'radix-ui';
import type { ReactNode } from 'react';

export function ReportsLayout({
  admin = false,
  children,
}: {
  admin?: boolean;
  children: ReactNode;
}) {
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
        {children}
      </div>
    </Tooltip.Provider>
  );
}
