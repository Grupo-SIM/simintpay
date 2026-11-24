'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { CreateAccountDialog } from './components';
import UsuariosTab from './_components/UsuariosTab';

function ContasContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: loadingUser } = useCurrentUser();

  const requested = searchParams.get('tab');
  const [createOpen, setCreateOpen] = useState(requested === 'criar-conta');
  const [refreshKey, setRefreshKey] = useState(0);

  const [previousRequested, setPreviousRequested] = useState(requested);
  if (previousRequested !== requested) {
    setPreviousRequested(requested);
    if (requested === 'criar-conta') setCreateOpen(true);
  }
  useEffect(() => {
    if (requested === 'criar-conta') {
      router.replace('/admin/contas', { scroll: false });
    }
  }, [requested, router]);

  useEffect(() => {
    if (!loadingUser && !user?.isAdmin) router.replace('/painel');
  }, [loadingUser, user?.isAdmin, router]);

  if (loadingUser || !user?.isAdmin) return null;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Contas
        </h1>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-violet-500 bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
        >
          <UserPlus size={16} />
          Criar conta
        </button>
      </div>

      <UsuariosTab refreshKey={refreshKey} />
      {createOpen && (
        <CreateAccountDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}
    </div>
  );
}

export default function ContasPage() {
  return (
    <Suspense fallback={null}>
      <ContasContent />
    </Suspense>
  );
}
