'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';

import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Modal } from '@/components/ui/Modal';

function formatBRL(v: number) {
  return (v ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

type MinhaCobranca = {
  id: string;
  amount: number;
  description: string | null;
  status: string;
  dueDate: string | null;
};

/**
 * Popup que aparece quando o cliente tem cobrança PENDENTE gerada pelo master.
 * Mostra 1 vez por sessão para o MESMO conjunto de cobranças; se surgir uma
 * cobrança nova, aparece de novo — e a bolinha do menu persiste até pagar.
 */
export function CobrancaPendenteAlerta() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const [dispensadas, setDispensadas] = useState<string | null>(() =>
    typeof window !== 'undefined'
      ? sessionStorage.getItem('cobrancas-popup-visto')
      : null,
  );

  const { data } = useQuery({
    queryKey: ['minhas-cobrancas'],
    enabled: !!user && !user.isAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token'),
      });
      return api.get<{ data: MinhaCobranca[] }>(
        endpoints.admin.cobrancas.minhas,
      );
    },
  });

  const pendentes = useMemo(
    () => (data?.data ?? []).filter((c) => c.status === 'PENDING'),
    [data],
  );
  const totalPendente = useMemo(
    () => pendentes.reduce((acc, c) => acc + c.amount, 0),
    [pendentes],
  );
  // Chave do conjunto atual: cobrança nova → chave muda → popup volta a aparecer.
  const chaveAtual = useMemo(
    () =>
      pendentes
        .map((c) => c.id)
        .sort()
        .join(','),
    [pendentes],
  );

  const aberto =
    pendentes.length > 0 && Boolean(chaveAtual) && chaveAtual !== dispensadas;

  const dispensar = () => {
    sessionStorage.setItem('cobrancas-popup-visto', chaveAtual);
    setDispensadas(chaveAtual);
  };

  if (!user || user.isAdmin || pendentes.length === 0) return null;

  return (
    <Modal
      open={aberto}
      onClose={dispensar}
      title="Você tem cobrança pendente"
      maxWidth="max-w-md"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Você tem <b>{pendentes.length}</b> cobrança(s) pendente(s),
            totalizando <b>{formatBRL(totalPendente)}</b>.
          </p>
        </div>

        <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
          {pendentes.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
            >
              <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">
                {c.description || 'Cobrança'}
                {c.dueDate && (
                  <span className="ml-2 text-xs text-zinc-400">
                    vence {new Date(c.dueDate).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </span>
              <span className="ml-3 shrink-0 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatBRL(c.amount)}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={dispensar}
            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
          >
            Depois
          </button>
          <button
            type="button"
            onClick={() => {
              dispensar();
              router.push('/cobrancas');
            }}
            className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-violet-700"
          >
            Ver e pagar
          </button>
        </div>
      </div>
    </Modal>
  );
}
