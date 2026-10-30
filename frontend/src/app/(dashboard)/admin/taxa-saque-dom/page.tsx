'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Building2, CircleDollarSign, RefreshCw } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { Spinner } from '@/components/ui/Loading';
import { useToast } from '@/components/ui/Toast';

function makeApi() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}

export default function TaxaSaqueDomPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: loadingUser } = useCurrentUser();
  const canAccess = Boolean(user?.isAdmin);

  const [confirmOpen, setConfirmOpen] = useState<'apply' | 'undo' | null>(null);

  const applyMutation = useMutation({
    mutationFn: () =>
      makeApi().post<{ amount: number; platformTag: string }>(
        '/admin/saques/dom-fee',
        {},
      ),
    onSuccess: (data) => {
      toast({
        type: 'success',
        title: 'Taxa DOM aplicada',
        description: `R$ ${data.amount.toFixed(2)} registrado.`,
      });
      setConfirmOpen(null);
    },
    onError: (e: unknown) => {
      toast({
        type: 'error',
        title: 'Erro',
        description: e instanceof Error ? e.message : 'Falha ao aplicar.',
      });
      setConfirmOpen(null);
    },
  });

  const undoMutation = useMutation({
    mutationFn: () =>
      makeApi().post<{ amount: number; platformTag: string }>(
        '/admin/saques/dom-fee/undo',
        {},
      ),
    onSuccess: (data) => {
      toast({
        type: 'success',
        title: 'Taxa DOM desfeita',
        description: `R$ ${Math.abs(data.amount).toFixed(2)} compensado.`,
      });
      setConfirmOpen(null);
    },
    onError: (e: unknown) => {
      toast({
        type: 'error',
        title: 'Erro',
        description: e instanceof Error ? e.message : 'Falha ao desfazer.',
      });
      setConfirmOpen(null);
    },
  });

  if (!loadingUser && !canAccess) {
    router.replace('/painel');
    return null;
  }

  const isPending = applyMutation.isPending || undoMutation.isPending;

  return (
    <div
      className="mx-auto flex max-w-2xl flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 px-3 pb-10 pt-2 sm:px-4"
      style={{ fontFamily: "'Inter', sans-serif", minHeight: '100%' }}
    >
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-3xl">
            Taxa de Saque — <span className="text-violet-400">DOM</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Registre manualmente o custo DOM por saque (R$ 3,50 por operação).
          </p>
        </div>
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-violet-500/20 bg-violet-500/10">
          <Building2 className="h-7 w-7 text-violet-400" />
        </div>
      </div>

      {/* Action card */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5 dark:shadow-2xl dark:backdrop-blur-xl">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-500 leading-relaxed dark:text-zinc-400">
            Cada clique em{' '}
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              Aplicar Taxa DOM
            </span>{' '}
            registra R$ 3,50 de custo operacional DOM para saques. O valor
            acumulado aparece no card{' '}
            <span className="text-violet-600 font-mono dark:text-violet-300">
              Taxa de Saque — DOM
            </span>{' '}
            no relatório financeiro.
          </p>

          <div className="flex flex-wrap gap-3">
            {/* Aplicar Taxa DOM */}
            {confirmOpen === 'apply' ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <span className="text-sm text-emerald-700 dark:text-emerald-300">
                  Confirmar aplicação?
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => applyMutation.mutate()}
                  className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {applyMutation.isPending ? (
                    <Spinner size={14} />
                  ) : (
                    'Confirmar'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirmOpen('apply')}
                className="flex h-11 items-center gap-2 rounded-2xl bg-emerald-600 px-6 text-sm font-bold text-white transition hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-50"
              >
                <CircleDollarSign size={16} />
                Aplicar Taxa DOM
              </button>
            )}

            {/* Desfazer Taxa DOM */}
            {confirmOpen === 'undo' ? (
              <div className="flex items-center gap-3 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3">
                <span className="text-sm text-orange-700 dark:text-orange-300">
                  Confirmar desfazer?
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => undoMutation.mutate()}
                  className="rounded-xl bg-orange-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-500 disabled:opacity-50"
                >
                  {undoMutation.isPending ? <Spinner size={14} /> : 'Confirmar'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirmOpen('undo')}
                className="flex h-11 items-center gap-2 rounded-2xl border border-orange-500 px-6 text-sm font-bold text-orange-400 transition hover:bg-orange-500/10 active:scale-[0.98] disabled:opacity-50"
              >
                <RefreshCw size={16} />
                Desfazer Taxa DOM
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-white/5 dark:bg-white/3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2 dark:text-zinc-600">
          Como funciona
        </p>
        <p className="text-xs text-zinc-500 leading-relaxed">
          <span className="text-zinc-700 font-medium dark:text-zinc-300">
            Aplicar Taxa DOM
          </span>{' '}
          registra R$ 3,50 de custo operacional DOM para saques globalmente.{' '}
          <span className="text-zinc-700 font-medium dark:text-zinc-300">
            Desfazer
          </span>{' '}
          compensa o último registro. O valor acumulado aparece como{' '}
          <span className="text-violet-600 font-mono dark:text-violet-300">
            Taxa de Saque — DOM
          </span>{' '}
          nos relatórios financeiros. A taxa cobrada do usuário vai
          integralmente para{' '}
          <span className="text-violet-600 font-mono dark:text-violet-300">
            Taxa de Saque — Simintpay
          </span>
          .
        </p>
      </div>
    </div>
  );
}
