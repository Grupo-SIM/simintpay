'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  RefreshCw,
  Search,
  UserPlus,
  Link2,
  Users,
  Wallet as WalletIcon,
  Percent,
  ChevronDown,
  Check,
  X,
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useToast } from '@/components/ui/Toast';
import { cn, getPlatformBadgeClass } from '@/lib/utils';

type AffiliateRow = {
  id: string;
  name: string;
  email: string;
  commissionPercent: string | number | null;
  affiliateCode: string | null;
  totalReferrals: number;
  totalCommission: number;
  platform?: string;
};

type Wallet = { balance: number; lockedBalance: number } | null;
type ReferralDetail = {
  affiliate: {
    id: string;
    name: string;
    email: string;
    wallet: Wallet;
    platformBalance?: number;
  } | null;
  referrals: {
    id: string;
    name: string;
    email: string;
    generated: number;
    grossTotal?: number;
    purchases?: {
      title: string;
      type?: string;
      grossAmount: number;
      commissionAmount: number;
      createdAt?: string | null;
    }[];
    wallet: Wallet;
  }[];
};

type Candidate = {
  id: string;
  name: string;
  email: string;
  isAffiliate: boolean;
  referredByUserId: string | null;
  referredBy: { id: string; name: string; email: string } | null;
};

const PLATFORM_LABEL: Record<string, string> = {
  SIMINTPAY: 'Sim Int Pay',
  EBOOK: 'Ebook',
  ATLAS: 'Atlas',
};

/** O que "afiliado" e "indicados" significam muda de plataforma pra plataforma. */
const PLATFORM_ORDER = ['SIMINTPAY', 'EBOOK', 'ATLAS'];
const PLATFORM_META: Record<
  string,
  { description: string; referralsLabel: string }
> = {
  SIMINTPAY: {
    description:
      'Pessoas que indicam novos clientes para a Sim Int Pay e ganham comissão por isso.',
    referralsLabel: 'Indicados',
  },
  EBOOK: {
    description: 'Vendem o livro de outra pessoa e ganham comissão por venda.',
    referralsLabel: 'Vendas',
  },
  ATLAS: {
    description:
      'Contas que compraram ou se cadastraram pelo link de outra pessoa.',
    referralsLabel: 'Indicados',
  },
};

const INPUT_CLASS =
  'h-9 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100';
const GHOST_BTN =
  'flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10';
const TH_CLASS =
  'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

const PURCHASE_TYPE_LABEL: Record<string, string> = {
  subscription: 'Assinatura',
  domain: 'Domínio',
  vps: 'VPS',
};

function formatDate(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

/** Remove o sufixo "Pessoa Física"/"Pessoa Jurídica" que algumas plataformas anexam ao nome. */
function cleanName(name: string): string {
  const cleaned = name
    .replace(/\s*[-–(]?\s*pessoa\s+(f[ií]sica|jur[ií]dica)\s*\)?\s*$/i, '')
    .trim();
  return cleaned || name;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          tone,
        )}
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        <p className="truncate text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {value}
        </p>
      </div>
    </div>
  );
}

function Avatar({ name, tone }: { name: string; tone: 'violet' | 'zinc' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        tone === 'violet'
          ? 'h-9 w-9 bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
          : 'h-8 w-8 bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300',
      )}
    >
      {initials(name)}
    </span>
  );
}

export default function AfiliadosTab() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: loadingUser } = useCurrentUser();

  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);

  const [percentDrafts, setPercentDrafts] = useState<Record<string, string>>(
    {},
  );
  const [savingId, setSavingId] = useState<string | null>(null);

  const [linkSearch, setLinkSearch] = useState('');
  const [linkCandidates, setLinkCandidates] = useState<Candidate[]>([]);
  const [linkTarget, setLinkTarget] = useState<Candidate | null>(null);
  const [linkAffiliateId, setLinkAffiliateId] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);

  const [listFilter, setListFilter] = useState('');

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReferralDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  function getApi() {
    const token = localStorage.getItem('access_token');
    return createApiClient({
      baseUrl: getDefaultApiBaseUrl(),
      getToken: () => token ?? undefined,
    });
  }

  const fetchAffiliates = useCallback(() => {
    return getApi()
      .get<{ data: AffiliateRow[] }>(endpoints.admin.afiliados.list)
      .then((res) => {
        setAffiliates(
          (res.data ?? [])
            .filter(
              (a) =>
                !a.platform ||
                a.platform === 'SIMINTPAY' ||
                Number(a.totalCommission) > 0,
            )
            .map((a) => ({ ...a, name: cleanName(a.name) })),
        );
      })
      .catch((err: unknown) => {
        toast({
          type: 'error',
          title: 'Erro',
          description:
            err instanceof Error ? err.message : 'Erro ao carregar afiliados.',
        });
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    if (!loadingUser && user?.isMasterAdmin) fetchAffiliates();
  }, [loadingUser, user?.isMasterAdmin, fetchAffiliates]);

  if (!loadingUser && !user?.isMasterAdmin) {
    router.replace('/painel');
    return null;
  }

  async function toggleReferrals(a: AffiliateRow) {
    const key = `${a.platform ?? 'SIMINTPAY'}:${a.id}`;
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const res = await getApi().get<{ data: ReferralDetail }>(
        endpoints.admin.afiliados.referrals(a.id, a.platform ?? 'SIMINTPAY'),
      );
      setDetail({
        ...res.data,
        affiliate: res.data.affiliate
          ? { ...res.data.affiliate, name: cleanName(res.data.affiliate.name) }
          : null,
        referrals: (res.data.referrals ?? []).map((r) => ({
          ...r,
          name: cleanName(r.name),
        })),
      });
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Erro ao carregar indicados.',
      });
      setOpenKey(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  function walletCell(w: Wallet) {
    if (!w) return <span className="text-zinc-400">Sem conta Sim Int Pay</span>;
    return (
      <span>
        {formatCurrency(w.balance)}
        {w.lockedBalance > 0 && (
          <span className="text-xs text-zinc-400">
            {' '}
            (bloq. {formatCurrency(w.lockedBalance)})
          </span>
        )}
      </span>
    );
  }

  async function handleSearch() {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const api = getApi();
      const res = await api.get<{ data: Candidate[] }>(
        `${endpoints.admin.afiliados.search}?q=${encodeURIComponent(search.trim())}`,
      );
      setCandidates(res.data ?? []);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro na busca',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setSearching(false);
    }
  }

  async function handleActivate(candidate: Candidate) {
    setSavingId(candidate.id);
    try {
      const api = getApi();
      await api.patch(endpoints.admin.afiliados.setAffiliate(candidate.id), {
        isAffiliate: true,
        commissionPercent: 10,
      });
      toast({
        type: 'success',
        title: 'Afiliado ativado',
        description: `${candidate.name} agora é afiliado (10% — ajuste na lista).`,
      });
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
      fetchAffiliates();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro ao ativar',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeactivate(row: AffiliateRow) {
    setSavingId(row.id);
    try {
      const api = getApi();
      await api.patch(endpoints.admin.afiliados.setAffiliate(row.id), {
        isAffiliate: false,
      });
      toast({
        type: 'success',
        title: 'Afiliado desativado',
        description: `${row.name} não gera mais comissão.`,
      });
      fetchAffiliates();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro ao desativar',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handleSavePercent(row: AffiliateRow) {
    const draft = percentDrafts[row.id];
    if (draft === undefined) return;
    const percent = Number(draft.replace(',', '.'));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast({
        type: 'error',
        title: '% inválida',
        description: 'Informe um valor entre 0 e 100.',
      });
      return;
    }
    setSavingId(row.id);
    try {
      const api = getApi();
      await api.patch(endpoints.admin.afiliados.setAffiliate(row.id), {
        commissionPercent: percent,
      });
      toast({
        type: 'success',
        title: 'Comissão atualizada',
        description: `${row.name} agora ganha ${percent}%.`,
      });
      setPercentDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      fetchAffiliates();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro ao salvar',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handleLinkSearch() {
    if (!linkSearch.trim()) return;
    try {
      const api = getApi();
      const res = await api.get<{ data: Candidate[] }>(
        `${endpoints.admin.afiliados.search}?q=${encodeURIComponent(linkSearch.trim())}`,
      );
      setLinkCandidates(res.data ?? []);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro na busca',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    }
  }

  async function handleSaveLink() {
    if (!linkTarget) return;
    setLinkSaving(true);
    try {
      const api = getApi();
      await api.patch(endpoints.admin.afiliados.setReferredBy(linkTarget.id), {
        referredByUserId: linkAffiliateId || null,
      });
      toast({
        type: 'success',
        title: 'Indicação vinculada',
        description: linkAffiliateId
          ? `${linkTarget.name} agora está vinculado a esse afiliado.`
          : `Vínculo de ${linkTarget.name} removido.`,
      });
      setLinkTarget(null);
      setLinkAffiliateId('');
      setLinkCandidates([]);
      setLinkSearch('');
      fetchAffiliates();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro ao vincular',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setLinkSaving(false);
    }
  }

  const filteredAffiliates = affiliates.filter((a) => {
    const q = listFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
    );
  });
  const groups = PLATFORM_ORDER.map((key) => ({
    key,
    rows: filteredAffiliates.filter((a) => (a.platform ?? 'SIMINTPAY') === key),
  })).filter((g) => g.rows.length > 0);
  const platformsWithAffiliates = new Set(
    affiliates.map((a) => a.platform ?? 'SIMINTPAY'),
  ).size;
  const totalCommission = affiliates.reduce(
    (sum, a) => sum + (a.totalCommission ?? 0),
    0,
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Resumo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={Users}
          label="Afiliados ativos"
          value={String(affiliates.length)}
          tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
        />
        <StatCard
          icon={UserPlus}
          label="Plataformas com afiliados"
          value={String(platformsWithAffiliates)}
          tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
        />
        <StatCard
          icon={WalletIcon}
          label="Comissão gerada"
          value={formatCurrency(totalCommission)}
          tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        />
      </div>

      {/* Cartões "Ativar novo afiliado" e "Vincular indicação manualmente" desativados por ora
         (gestão manual do programa Sim Int Pay). Para reativar, remova este comentário.
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">

         Ativar novo afiliado
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              <UserPlus size={14} />
            </span>
            Ativar novo afiliado
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Busque a conta e ative. A comissão começa em 10% e pode ser ajustada na lista.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder="Buscar por nome ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className={INPUT_CLASS}
            />
            <button onClick={handleSearch} disabled={searching} className={GHOST_BTN}>
              {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
              Buscar
            </button>
          </div>
          {candidates.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {candidates.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 px-3 py-2 dark:border-white/10">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={c.name} tone="zinc" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.name}</p>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{c.email}</p>
                    </div>
                  </div>
                  {c.isAffiliate ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      <Check size={12} /> Já é afiliado
                    </span>
                  ) : (
                    <button
                      onClick={() => handleActivate(c)}
                      disabled={savingId === c.id}
                      className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
                    >
                      {savingId === c.id ? "Ativando..." : "Ativar"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

         Vincular indicação manual
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
              <Link2 size={14} />
            </span>
            Vincular indicação manualmente
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Busque a conta indicada, depois escolha (ou remova) o afiliado responsável por ela.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder="Buscar conta indicada por nome ou e-mail..."
              value={linkSearch}
              onChange={(e) => setLinkSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLinkSearch()}
              className={INPUT_CLASS}
            />
            <button onClick={handleLinkSearch} className={GHOST_BTN}>
              <Search size={14} />
              Buscar
            </button>
          </div>
          {linkCandidates.length > 0 && !linkTarget && (
            <div className="mt-3 flex flex-col gap-2">
              {linkCandidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setLinkTarget(c);
                    setLinkAffiliateId(c.referredByUserId ?? "");
                  }}
                  className="flex items-center gap-3 rounded-xl border border-zinc-100 px-3 py-2 text-left transition hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/10"
                >
                  <Avatar name={c.name} tone="zinc" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.name}</p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{c.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {linkTarget && (
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-500/20 dark:bg-violet-500/10">
              <p className="text-[10px] font-bold uppercase tracking-widest text-violet-600 dark:text-violet-300">Conta indicada</p>
              <p className="mt-0.5 text-sm text-zinc-900 dark:text-zinc-100">{linkTarget.name} — {linkTarget.email}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {linkTarget.referredBy
                  ? <>Indicado atualmente por: <strong>{linkTarget.referredBy.name}</strong> ({linkTarget.referredBy.email})</>
                  : "Sem afiliado vinculado atualmente."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select
                  value={linkAffiliateId}
                  onChange={(e) => setLinkAffiliateId(e.target.value)}
                  className="h-9 min-w-[200px] flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="">Sem afiliado (remover vínculo)</option>
                  {affiliates.filter((a) => !a.platform || a.platform === "SIMINTPAY").map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
                  ))}
                </select>
                <button
                  onClick={handleSaveLink}
                  disabled={linkSaving}
                  className="h-9 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
                >
                  {linkSaving ? "Salvando..." : "Salvar"}
                </button>
                <button
                  onClick={() => { setLinkTarget(null); setLinkAffiliateId(""); }}
                  className="h-9 rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      */}

      {/* Lista de afiliados ativos */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Afiliados ativos
            <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
              {filteredAffiliates.length}
            </span>
          </h2>
          <div className="relative w-full max-w-xs">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="text"
              placeholder="Filtrar por nome ou e-mail..."
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              className={cn(INPUT_CLASS, 'w-full pl-9')}
            />
          </div>
        </div>

        {loading || filteredAffiliates.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-12 text-center text-sm text-zinc-400 dark:border-white/10 dark:bg-white/5 dark:text-zinc-500">
            {loading ? (
              <RefreshCw size={20} className="mx-auto animate-spin" />
            ) : affiliates.length === 0 ? (
              'Nenhum afiliado ativo ainda.'
            ) : (
              'Nenhum afiliado encontrado para esse filtro.'
            )}
          </div>
        ) : (
          groups.map((g) => {
            const meta = PLATFORM_META[g.key];
            const label = PLATFORM_LABEL[g.key] ?? g.key;
            return (
              <section key={g.key} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      getPlatformBadgeClass(label),
                    )}
                  >
                    {label}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {meta?.description}
                  </span>
                  <span className="text-xs text-zinc-400">
                    · {g.rows.length}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-white/5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 dark:border-white/10">
                        <th className={cn(TH_CLASS, 'text-left')}>Afiliado</th>
                        <th className={cn(TH_CLASS, 'text-left')}>Comissão</th>
                        <th className={cn(TH_CLASS, 'text-center')}>
                          {meta?.referralsLabel ?? 'Indicados'}
                        </th>
                        <th className={cn(TH_CLASS, 'text-right')}>
                          Comissão gerada
                        </th>
                        <th className={cn(TH_CLASS, 'text-right')}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((a) => {
                        const rowKey = `${a.platform ?? 'SIMINTPAY'}:${a.id}`;
                        const isOpen = openKey === rowKey;
                        const external =
                          !!a.platform && a.platform !== 'SIMINTPAY';
                        const isNativePlatform = !external;
                        const draft = percentDrafts[a.id];
                        const dirty =
                          draft !== undefined &&
                          draft !== String(a.commissionPercent ?? '');
                        return (
                          <Fragment key={rowKey}>
                            <tr className="border-b border-zinc-50 transition last:border-0 hover:bg-zinc-50/60 dark:border-white/5 dark:hover:bg-white/[0.03]">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <Avatar name={a.name} tone="violet" />
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                                      {a.name}
                                    </p>
                                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                      {a.email}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {external ? (
                                  <span className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300">
                                    <Percent
                                      size={12}
                                      className="text-zinc-400"
                                    />
                                    {a.commissionPercent != null
                                      ? `${a.commissionPercent}%`
                                      : '—'}
                                  </span>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <div className="relative">
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={
                                          draft ??
                                          String(a.commissionPercent ?? '')
                                        }
                                        onChange={(e) =>
                                          setPercentDrafts((prev) => ({
                                            ...prev,
                                            [a.id]: e.target.value,
                                          }))
                                        }
                                        onKeyDown={(e) =>
                                          e.key === 'Enter' &&
                                          dirty &&
                                          handleSavePercent(a)
                                        }
                                        className="h-8 w-20 rounded-lg border border-zinc-200 bg-white pl-2 pr-6 text-sm tabular-nums text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
                                      />
                                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
                                        %
                                      </span>
                                    </div>
                                    {dirty && (
                                      <>
                                        <button
                                          onClick={() => handleSavePercent(a)}
                                          disabled={savingId === a.id}
                                          title="Salvar comissão"
                                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white transition hover:bg-violet-500 disabled:opacity-50"
                                        >
                                          <Check size={14} />
                                        </button>
                                        <button
                                          onClick={() =>
                                            setPercentDrafts((prev) => {
                                              const next = { ...prev };
                                              delete next[a.id];
                                              return next;
                                            })
                                          }
                                          title="Descartar"
                                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/10"
                                        >
                                          <X size={14} />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center tabular-nums text-zinc-700 dark:text-zinc-300">
                                {a.totalReferrals}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                                {formatCurrency(a.totalCommission)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => toggleReferrals(a)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300"
                                  >
                                    {isOpen ? 'Ocultar' : 'Ver indicados'}
                                    <ChevronDown
                                      size={12}
                                      className={cn(
                                        'transition-transform',
                                        isOpen && 'rotate-180',
                                      )}
                                    />
                                  </button>
                                  {!external && (
                                    <button
                                      onClick={() => handleDeactivate(a)}
                                      disabled={savingId === a.id}
                                      className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
                                    >
                                      Desativar
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="border-b border-zinc-50 bg-zinc-50/60 dark:border-white/5 dark:bg-white/[0.03]">
                                <td colSpan={5} className="px-6 py-4">
                                  {loadingDetail || !detail ? (
                                    <RefreshCw
                                      size={16}
                                      className="animate-spin text-zinc-400"
                                    />
                                  ) : (
                                    <div className="flex flex-col gap-3">
                                      {detail.referrals.length === 0 ? (
                                        <p className="text-xs text-zinc-400">
                                          {a.platform === 'EBOOK'
                                            ? 'Nenhuma venda por link deste afiliado ainda.'
                                            : a.platform === 'ATLAS'
                                              ? 'Nenhuma conta comprou ou se cadastrou pelo link deste afiliado ainda.'
                                              : 'Nenhuma conta indicada por este afiliado ainda.'}
                                        </p>
                                      ) : (
                                        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-white/5">
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="border-b border-zinc-100 text-left text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                                                <th className="px-3 py-2 font-semibold">
                                                  {a.platform === 'EBOOK'
                                                    ? 'Comprador'
                                                    : 'Comprou / se cadastrou pelo link'}
                                                </th>
                                                <th className="px-3 py-2 font-semibold">
                                                  E-mail
                                                </th>
                                                {isNativePlatform ? (
                                                  <th className="px-3 py-2 font-semibold">
                                                    Carteira
                                                  </th>
                                                ) : (
                                                  <th className="px-3 py-2 font-semibold">
                                                    O que comprou
                                                  </th>
                                                )}
                                                {!isNativePlatform && (
                                                  <th className="px-3 py-2 text-right font-semibold">
                                                    Valor da compra
                                                  </th>
                                                )}
                                                <th className="px-3 py-2 text-right font-semibold">
                                                  Comissão gerada
                                                </th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {detail.referrals.map((r) => (
                                                <tr
                                                  key={r.id}
                                                  className="border-t border-zinc-100 align-top first:border-0 dark:border-white/5"
                                                >
                                                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                                                    {r.name}
                                                  </td>
                                                  <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                                                    {r.email}
                                                  </td>
                                                  {isNativePlatform ? (
                                                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                                                      {walletCell(r.wallet)}
                                                    </td>
                                                  ) : (
                                                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                                                      {r.purchases &&
                                                      r.purchases.length > 0 ? (
                                                        <ul className="flex flex-col gap-1">
                                                          {r.purchases.map(
                                                            (p, i) => (
                                                              <li
                                                                key={i}
                                                                className="flex flex-wrap items-center gap-x-2"
                                                              >
                                                                <span>
                                                                  {p.title}
                                                                </span>
                                                                {p.type && (
                                                                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
                                                                    {PURCHASE_TYPE_LABEL[
                                                                      p.type
                                                                    ] ?? p.type}
                                                                  </span>
                                                                )}
                                                                {p.createdAt && (
                                                                  <span className="text-[10px] text-zinc-400">
                                                                    {formatDate(
                                                                      p.createdAt,
                                                                    )}
                                                                  </span>
                                                                )}
                                                              </li>
                                                            ),
                                                          )}
                                                        </ul>
                                                      ) : (
                                                        <span className="text-zinc-400">
                                                          Só se cadastrou (sem
                                                          compra)
                                                        </span>
                                                      )}
                                                    </td>
                                                  )}
                                                  {!isNativePlatform && (
                                                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                      {formatCurrency(
                                                        r.grossTotal ?? 0,
                                                      )}
                                                    </td>
                                                  )}
                                                  <td className="px-3 py-2 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                                                    {formatCurrency(
                                                      r.generated,
                                                    )}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
