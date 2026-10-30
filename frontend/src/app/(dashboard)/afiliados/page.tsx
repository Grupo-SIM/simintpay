'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, RefreshCw, Users, Wallet } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useToast } from '@/components/ui/Toast';

type Referral = { id: string; name: string; email: string; createdAt: string };
type Commission = {
  id: string;
  transactionId: string;
  commissionAmount: number;
  status: 'CREDITED' | 'REVERSED';
  createdAt: string;
};

type AffiliateMe = {
  isAffiliate: boolean;
  affiliateCode: string | null;
  referrals: Referral[];
  commissions: Commission[];
  totalEarned: number;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export default function AfiliadosPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: loadingUser } = useCurrentUser();

  const [data, setData] = useState<AffiliateMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function getApi() {
    const token = localStorage.getItem('access_token');
    return createApiClient({
      baseUrl: getDefaultApiBaseUrl(),
      getToken: () => token ?? undefined,
    });
  }

  useEffect(() => {
    if (loadingUser) return;
    if (!user?.isAffiliate) {
      router.replace('/painel');
      return;
    }
    const api = getApi();
    api
      .get<{ data: AffiliateMe }>(endpoints.afiliados.me)
      .then((res) => {
        setData(res.data);
        setError(null);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : 'Erro ao carregar seus dados de afiliado.';
        setError(message);
        toast({ type: 'error', title: 'Erro', description: message });
      })
      .finally(() => setLoading(false));
  }, [loadingUser, user?.isAffiliate]);

  if (loadingUser || loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-12 text-zinc-400 dark:text-zinc-500">
        <RefreshCw size={20} className="animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {error ?? 'Não foi possível carregar seus dados de afiliado.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const link = data.affiliateCode
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/cadastro?ref=${data.affiliateCode}`
    : '';

  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link);
    toast({ type: 'success', title: 'Link copiado', description: link });
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Afiliados
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Contas que você indicou e a comissão gerada por elas.
        </p>
      </div>

      {/* Link de indicação */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Seu link de indicação
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 truncate rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
            {link}
          </code>
          <button
            onClick={copyLink}
            className="flex h-9 items-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-medium text-white transition hover:bg-violet-500"
          >
            <Copy size={14} />
            Copiar
          </button>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
            <Users size={18} />
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Contas indicadas
            </p>
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {data.referrals.length}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <Wallet size={18} />
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Total ganho
            </p>
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {formatCurrency(data.totalEarned)}
            </p>
          </div>
        </div>
      </div>

      {/* Indicados */}
      <div className="rounded-2xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-white/5">
        <div className="border-b border-zinc-100 px-5 py-3 dark:border-white/10">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Contas indicadas
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-white/10">
              <th className="px-4 py-2 text-left font-semibold text-zinc-500 dark:text-zinc-400">
                Nome
              </th>
              <th className="px-4 py-2 text-left font-semibold text-zinc-500 dark:text-zinc-400">
                E-mail
              </th>
              <th className="px-4 py-2 text-left font-semibold text-zinc-500 dark:text-zinc-400">
                Desde
              </th>
            </tr>
          </thead>
          <tbody>
            {data.referrals.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-zinc-400 dark:text-zinc-500"
                >
                  Nenhuma conta indicada ainda.
                </td>
              </tr>
            ) : (
              data.referrals.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-zinc-50 last:border-0 dark:border-white/5"
                >
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">
                    {r.name}
                  </td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">
                    {r.email}
                  </td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">
                    {formatDate(r.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Extrato de comissão */}
      <div className="rounded-2xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-white/5">
        <div className="border-b border-zinc-100 px-5 py-3 dark:border-white/10">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Extrato de comissão
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-white/10">
              <th className="px-4 py-2 text-left font-semibold text-zinc-500 dark:text-zinc-400">
                Data
              </th>
              <th className="px-4 py-2 text-right font-semibold text-zinc-500 dark:text-zinc-400">
                Valor
              </th>
              <th className="px-4 py-2 text-center font-semibold text-zinc-500 dark:text-zinc-400">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {data.commissions.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-zinc-400 dark:text-zinc-500"
                >
                  Nenhuma comissão gerada ainda.
                </td>
              </tr>
            ) : (
              data.commissions.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-zinc-50 last:border-0 dark:border-white/5"
                >
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">
                    {formatDate(c.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-zinc-900 dark:text-zinc-100">
                    {formatCurrency(c.commissionAmount)}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {c.status === 'CREDITED' ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                        Creditada
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-500/15 dark:text-red-400">
                        Revertida
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
