'use client';

import type { ReactNode } from 'react';
import { DashboardPageSkeleton } from '../components';
import { useCurrentUser } from '@/hooks/use-current-user';

export default function ClienteLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useCurrentUser();

  if (loading) {
    return <DashboardPageSkeleton />;
  }

  if (!user?.isClient) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 py-20 text-center">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Acesso restrito.
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Esta área é exclusiva para clientes SimintPay.
        </p>
      </div>
    );
  }

  if (user.clientStatus !== 'APPROVED') {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center justify-center gap-3 py-20">
        <div className="w-full rounded-2xl border border-amber-200/80 bg-amber-50 p-8 text-center shadow-sm dark:border-amber-500/20 dark:bg-amber-500/10">
          <h1 className="text-lg font-semibold text-amber-900 dark:text-amber-200">
            {user.clientStatus === 'REJECTED'
              ? 'Sua conta não foi aprovada.'
              : 'Sua conta está em análise.'}
          </h1>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300/90">
            Você poderá criar links e planos assim que for aprovada pela equipe.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
