'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SalePushControl } from '@/components/notifications';
import { disableSalePush } from '@/lib/sale-push';
import { useToast } from '@/components/ui/Toast';
import { clearAccessToken } from '@/lib/auth';
import { LogOut, ChevronDown } from 'lucide-react';
import { useCurrentUser, clearUserCache } from '@/hooks/use-current-user';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Navbar() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSair() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await disableSalePush();
      clearAccessToken();
      clearUserCache();
      queryClient.clear();
      router.replace('/login');
    } catch (error) {
      toast({
        type: 'error',
        title: 'Não foi possível sair',
        description:
          error instanceof Error
            ? error.message
            : 'Tente novamente para remover notificações deste dispositivo antes de sair.',
      });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        .nb-search-wrap { display: flex; align-items: center; gap: 8px; background: var(--nb-search-bg); border: 1px solid var(--nb-search-border); border-radius: 10px; padding: 8px 14px; flex: 0 1 auto; width: 100%; max-width: 340px; transition: all 0.2s; }
        .nb-search-wrap:focus-within { background: var(--nb-search-bg-focus); border-color: var(--nb-search-border-focus); }
        .nb-search-input { background: transparent; border: none; outline: none; color: var(--nb-search-input); font-size: 13px; flex: 1; font-family: 'Inter', sans-serif; }
        .nb-search-input::placeholder { color: var(--nb-search-placeholder); }
        .nb-icon-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--nb-icon-btn-border); background: var(--nb-icon-btn-bg); display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--nb-icon-btn-fg); transition: all 0.2s; }
        .nb-icon-btn:hover { background: var(--nb-icon-btn-hover-bg); color: var(--nb-icon-btn-hover-fg); border-color: var(--nb-icon-btn-hover-border); }
        .nb-user-btn { display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px 5px; border-radius: 12px; border: 1px solid var(--nb-user-btn-border); background: var(--nb-user-btn-bg); cursor: pointer; transition: all 0.2s; }
        .nb-user-btn:hover { background: var(--nb-user-btn-hover-bg); border-color: var(--nb-user-btn-hover-border); }
      `}</style>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'var(--nb-header-bg)',
          borderBottom: '1px solid var(--dashboard-header-border)',
          boxSizing: 'border-box',
          height: 'var(--dashboard-header-height, 80px)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 28px',
          gap: 16,
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }} aria-hidden />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          {user?.isClient && user.clientStatus === 'APPROVED' && (
            <SalePushControl userId={user.id} />
          )}
          {/* User */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="nb-user-btn">
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  {(user?.name ?? '?')[0].toUpperCase()}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <p
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: 'var(--nb-user-name)',
                      lineHeight: 1.2,
                    }}
                  >
                    {user?.name ?? '...'}
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: 'var(--nb-user-email)',
                      lineHeight: 1.2,
                    }}
                  >
                    {user?.email ?? ''}
                  </p>
                </div>
                <ChevronDown size={13} color="var(--nb-chevron)" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                disabled={signingOut}
                onClick={handleSair}
                style={{ gap: 8, cursor: 'pointer', color: '#ef4444' }}
              >
                <LogOut size={14} />
                {signingOut ? 'Saindo…' : 'Sair'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  );
}
