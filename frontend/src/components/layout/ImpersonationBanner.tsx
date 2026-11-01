'use client';

import { useSyncExternalStore } from 'react';
import { DoorClosed } from 'lucide-react';
import { isImpersonating, stopImpersonation } from '@/lib/auth';

type Props = { userName?: string | null };

/** Faixa fixa mostrada enquanto o admin está em "Acessar como" outro usuário. */
export function ImpersonationBanner({ userName }: Props) {
  const active = useSyncExternalStore(
    () => () => {},
    isImpersonating,
    () => false,
  );
  if (!active) return null;

  function back() {
    stopImpersonation();
    window.location.assign('/admin/contas');
  }

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950"
    >
      <span>
        Acessando como{' '}
        {userName ? <strong>{userName}</strong> : 'outro usuário'}
      </span>
      <button
        type="button"
        onClick={back}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1 text-xs font-semibold text-white transition hover:bg-zinc-800"
      >
        <DoorClosed size={14} />
        Voltar ao admin
      </button>
    </div>
  );
}
