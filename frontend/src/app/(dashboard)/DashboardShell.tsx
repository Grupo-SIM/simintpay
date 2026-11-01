'use client';

import type { ReactNode } from 'react';
import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/use-current-user';
import { canClientAccessPath } from '@/lib/dashboard-access';
import { DashboardPageSkeleton } from './components';

import { clearAccessToken, hasAccessTokenCookie } from '@/lib/auth';
import { ImpersonationBanner } from '@/components/layout/ImpersonationBanner';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { CobrancaPendenteAlerta } from '@/components/layout/CobrancaPendenteAlerta';

export default function DashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useCurrentUser();
  const clientBlocked = Boolean(
    user?.isClient && !canClientAccessPath(pathname),
  );
  const allowed = useSyncExternalStore(
    () => () => {},
    hasAccessTokenCookie,
    () => null,
  );

  useEffect(() => {
    const authenticated = hasAccessTokenCookie();
    if (!authenticated) {
      clearAccessToken();
      router.replace('/login');
    }
  }, [router]);

  if (allowed === null)
    return (
      <div className="p-6">
        <DashboardPageSkeleton />
      </div>
    );
  if (!allowed) return null;

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--dashboard-shell-bg)',
        // Mesma altura do bloco do logo (padding + área da imagem): alinha borda com o header
        ['--dashboard-header-height' as string]: '80px',
      }}
    >
      <Sidebar />
      {/* Popup de cobrança pendente (clientes) — bolinha do menu persiste até pagar */}
      <CobrancaPendenteAlerta />
      <div
        style={{
          marginLeft: 'var(--dashboard-sidebar-width)',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          minWidth: 0,
          transition: 'margin-left 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <ImpersonationBanner userName={user?.name} />
        <Navbar />
        <main
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            padding: '24px 28px',
            overflowX: 'hidden',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {loading ? (
            <DashboardPageSkeleton />
          ) : !user ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 p-6 dark:border-red-500/30"
            >
              Não foi possível verificar sua sessão. Atualize a página para
              tentar novamente.
            </div>
          ) : clientBlocked ? (
            <div
              role="alert"
              className="rounded-2xl border border-zinc-200 p-6 dark:border-white/10"
            >
              <h1 className="text-xl font-semibold">Acesso restrito</h1>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                Esta área não está disponível para clientes.
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
