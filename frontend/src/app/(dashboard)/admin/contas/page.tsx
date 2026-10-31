'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserPlus, UsersRound, Handshake, Info, Layers } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { cn } from '@/lib/utils';
import { CreateAccountDialog } from './components';
import UsuariosTab from './_components/UsuariosTab';
import AfiliadosTab from './_components/AfiliadosTab';
import PlataformasExternasTab from './_components/PlataformasExternasTab';

type TabKey = 'usuarios' | 'afiliados' | 'plataformas';

const TABS: {
  key: TabKey;
  label: string;
  icon: typeof UserPlus;
  description: string;
  masterOnly?: boolean;
}[] = [
  {
    key: 'usuarios',
    label: 'Usuários',
    icon: UsersRound,
    description:
      'Veja todas as pessoas que recebem vendas pelas plataformas e quanto cada uma tem de saldo.',
  },
  {
    key: 'afiliados',
    label: 'Afiliados',
    icon: Handshake,
    masterOnly: true,
    description:
      'Acompanhe os afiliados que já geraram comissão nas plataformas: quanto cada um ganhou e quem comprou ou se cadastrou pelo link dele.',
  },
  {
    key: 'plataformas',
    label: 'Plataformas',
    icon: Layers,
    masterOnly: true,
    description:
      'Usuários lidos direto do banco de cada SaaS externo (Atlas, EbookSim, Revalida, Patrimonial, PagaTG, Areaflix), separados em vendedores/operadores e usuários comuns.',
  },
];

const DEFAULT_TAB: TabKey = 'usuarios';

function ContasContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: loadingUser } = useCurrentUser();
  const isMaster = Boolean(user?.isMasterAdmin);

  const visibleTabs = TABS.filter((t) => !t.masterOnly || isMaster);
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
      router.replace('/admin/contas?tab=usuarios', { scroll: false });
    }
  }, [requested, router]);
  const tab: TabKey = visibleTabs.some((t) => t.key === requested)
    ? (requested as TabKey)
    : DEFAULT_TAB;
  const activeTab = TABS.find((t) => t.key === tab)!;

  useEffect(() => {
    if (!loadingUser && !user?.isAdmin) router.replace('/painel');
  }, [loadingUser, user?.isAdmin, router]);

  if (loadingUser || !user?.isAdmin) return null;

  function selectTab(key: TabKey) {
    router.replace(`/admin/contas?tab=${key}`, { scroll: false });
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Contas
          </h1>
          {tab === 'usuarios' && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-violet-500 bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
            >
              <UserPlus size={16} />
              Criar conta
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-white/10">
          {visibleTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => selectTab(key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
                tab === key
                  ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
              )}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {tab !== 'plataformas' && (
          <div className="flex items-start gap-2.5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100">
            <Info
              size={16}
              className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-300"
            />
            <p>{activeTab.description}</p>
          </div>
        )}
      </div>

      {tab === 'usuarios' && <UsuariosTab refreshKey={refreshKey} />}
      {tab === 'afiliados' && <AfiliadosTab />}
      {tab === 'plataformas' && <PlataformasExternasTab />}
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
