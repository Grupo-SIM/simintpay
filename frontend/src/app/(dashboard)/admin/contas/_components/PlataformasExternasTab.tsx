'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { Spinner } from '@/components/ui/Loading';
import { cn, getPlatformBadgeClass } from '@/lib/utils';

type ExternalPlatformSlug =
  'atlas' | 'ebooksim' | 'revalida' | 'patrimonial' | 'pagatg' | 'areaflix';

const PLATFORM_LABELS: Record<ExternalPlatformSlug, string> = {
  atlas: 'Atlas',
  ebooksim: 'EbookSim',
  revalida: 'Revalida',
  patrimonial: 'Patrimonial',
  pagatg: 'PagaTG',
  areaflix: 'Areaflix',
};

/**
 * Nome da primeira coluna por plataforma — o que "role=ADMIN" (ou equivalente)
 * significa muda de plataforma pra plataforma. Em Atlas o crivo é comissão de
 * afiliado de verdade; em Revalida é só quem administra o conteúdo, sem noção
 * de venda; em Patrimonial é quem assinou o SaaS com a Simintpay (dono da
 * Organization, multi-tenant); em Pagatg/Areaflix é o dono do SaaS.
 */
const VENDEDOR_LABELS: Record<ExternalPlatformSlug, string> = {
  atlas: 'Vendedores / afiliados',
  ebooksim: 'Vendedores / afiliados',
  revalida: 'Administradores',
  patrimonial: 'Assinantes do SaaS',
  pagatg: 'Operadores',
  areaflix: 'Operadores',
};

type Pessoa = {
  id: string;
  name: string | null;
  email: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  isActive?: boolean | null;
  createdAt?: string | null;
  organizationName?: string | null;
};

type PlatformResult = {
  platform: ExternalPlatformSlug;
  vendedores: Pessoa[];
  usuariosComuns: Pessoa[];
  tabelasSeparadas: boolean;
};

type ApiResponse = { data: PlatformResult[] };

function getApi() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token') ?? undefined,
  });
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PlataformasExternasTab() {
  const [openPlatform, setOpenPlatform] = useState<ExternalPlatformSlug | null>(
    null,
  );

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'plataformas-externas', 'usuarios'],
    queryFn: () =>
      getApi().get<ApiResponse>(endpoints.admin.plataformasExternasDb.listAll),
    staleTime: 60_000,
  });

  const results = data?.data ?? [];

  const totals = useMemo(() => {
    const vendedores = results.reduce((sum, r) => sum + r.vendedores.length, 0);
    const comuns = results.reduce((sum, r) => sum + r.usuariosComuns.length, 0);
    return {
      vendedores,
      comuns,
      pessoas: vendedores + comuns,
      plataformas: results.length,
    };
  }, [results]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-end gap-3">
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/5"
        >
          <RefreshCw size={14} className={cn(isFetching && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {!isLoading && results.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Plataformas" value={totals.plataformas} />
          <SummaryTile label="Pessoas no total" value={totals.pessoas} />
          <SummaryTile
            label="Vendedores"
            value={totals.vendedores}
            accent="violet"
          />
          <SummaryTile label="Usuários comuns" value={totals.comuns} />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {results.map((r) => (
            <PlatformCard
              key={r.platform}
              result={r}
              open={openPlatform === r.platform}
              onToggle={() =>
                setOpenPlatform((p) => (p === r.platform ? null : r.platform))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'violet';
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-900">
      <div
        className={cn(
          'text-2xl font-semibold tabular-nums',
          accent === 'violet'
            ? 'text-violet-600 dark:text-violet-400'
            : 'text-zinc-900 dark:text-zinc-100',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
    </div>
  );
}

function PlatformCard({
  result,
  open,
  onToggle,
}: {
  result: PlatformResult;
  open: boolean;
  onToggle: () => void;
}) {
  const [search, setSearch] = useState('');
  const total = result.vendedores.length + result.usuariosComuns.length;

  const query = search.trim().toLowerCase();
  const filterPerson = (p: Pessoa) =>
    query === '' ||
    (p.name ?? '').toLowerCase().includes(query) ||
    (p.email ?? '').toLowerCase().includes(query) ||
    (p.organizationName ?? '').toLowerCase().includes(query);

  const vendedoresFiltrados = result.vendedores.filter(filterPerson);
  const comunsFiltrados = result.usuariosComuns.filter(filterPerson);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-white transition-colors dark:bg-zinc-900',
        open
          ? 'border-violet-300 dark:border-violet-500/30'
          : 'border-zinc-200 dark:border-white/10',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[7.5rem_1fr_auto] items-center gap-4 px-4 py-3.5 text-left transition hover:bg-zinc-50 dark:hover:bg-white/5"
      >
        <span
          className={cn(
            'w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
            getPlatformBadgeClass(result.platform),
          )}
        >
          {PLATFORM_LABELS[result.platform]}
        </span>

        <div className="flex min-w-0 items-center">
          <span className="truncate text-sm text-zinc-500 dark:text-zinc-400">
            <strong className="font-semibold text-zinc-800 dark:text-zinc-100">
              {total}
            </strong>{' '}
            pessoa
            {total === 1 ? '' : 's'} ·{' '}
            <span className="text-violet-600 dark:text-violet-400">
              {result.vendedores.length}{' '}
              {VENDEDOR_LABELS[result.platform].toLowerCase()}
            </span>{' '}
            · {result.usuariosComuns.length} comum
            {result.usuariosComuns.length === 1 ? '' : 'ns'}
          </span>
        </div>

        <ChevronDown
          size={16}
          className={cn(
            'shrink-0 text-zinc-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="border-t border-zinc-100 dark:border-white/10">
          <div className="border-b border-zinc-100 px-4 py-2.5 dark:border-white/10">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Buscar em ${PLATFORM_LABELS[result.platform]}…`}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-3 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:focus:border-violet-500/40 dark:focus:bg-zinc-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-4 md:grid-cols-2">
            <PeopleList
              title={VENDEDOR_LABELS[result.platform]}
              icon={ShieldCheck}
              people={vendedoresFiltrados}
              hiddenCount={
                result.vendedores.length - vendedoresFiltrados.length
              }
              emptyLabel={
                query ? 'Nenhum resultado.' : 'Nenhum vendedor encontrado.'
              }
            />
            <PeopleList
              title="Usuários comuns"
              icon={Users}
              people={comunsFiltrados}
              hiddenCount={
                result.usuariosComuns.length - comunsFiltrados.length
              }
              emptyLabel={
                query ? 'Nenhum resultado.' : 'Nenhum usuário comum encontrado.'
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PeopleList({
  title,
  icon: Icon,
  people,
  hiddenCount,
  emptyLabel,
}: {
  title: string;
  icon: typeof Users;
  people: Pessoa[];
  hiddenCount: number;
  emptyLabel: string;
}) {
  const totalShown = people.length + hiddenCount;
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Icon size={13} />
        {title}
        <span className="font-normal normal-case text-zinc-400 dark:text-zinc-500">
          ({totalShown})
        </span>
      </div>
      {people.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">{emptyLabel}</p>
      ) : (
        <ul className="flex max-h-80 flex-col divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                {initials(p.name)}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {p.name ?? '—'}
                </span>
                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {p.email ?? 'sem e-mail'}
                  {p.isActive === false && ' · inativo'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
