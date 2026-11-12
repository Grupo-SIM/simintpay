'use client';

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Trash2,
  Pencil,
  Download,
  Wallet,
  Receipt,
  DoorOpen,
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { startImpersonation } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { HelpTooltip } from '@/components/ui/HelpTooltip';
import { PortalTooltip } from '@/components/ui/PortalTooltip';
import { cn, getPlatformBadgeClass, formatDocument } from '@/lib/utils';

import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { PlatformFilterSelect } from '@/components/product-platforms/PlatformFilterSelect';
import { Dropdown } from '@/components/ui/Dropdown';
import { AccountPlatformsButton } from '../components';
import type { Lead } from '@/features/admin/types/admin.types';
import { ClientChargesModal } from './charges';
import type { ChargeClient } from './charges/types';

type ClientStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type SimpayUser = {
  id: string;
  name: string;
  email: string;
  isCompany?: boolean;
  phone?: string | null;
  clientStatus?: ClientStatus | null;
};

type PlatformEntry = {
  id: string;
  platform: string;
  name: string;
  email: string | null;
  role?: 'owner' | 'user';
};

type ExternalUser = {
  id: string;
  cpf: string;
  name: string;
  platformEntries: PlatformEntry[];
  balanceAttribution?: {
    platformTag?: string;
    balanceCents?: number;
    pendingWithdrawalsGrossCents?: number;
  }[];
  balance: number;
  lockedBalance: number;
  vinculado: boolean;
  isAtivo: boolean | null;
  isDeleted: boolean;
  deletedAt: string | null;
  simpayUser: SimpayUser | null;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse = {
  data: ExternalUser[];
  total: number;
  page: number;
  pageSize: number;
};

const PLATFORM_LABELS: Record<string, string> = {
  ebook: 'EbookSim',
  renovada: 'Renovada',
  revalida: 'Revalida',
  bosque: 'Bosque',
  pagatg: 'PagaTG',
  atlas: 'AtlasHosting',
  'zero-grau': 'Zero Grau',
  areaflix: 'Áreaflix',
  simintpay: 'Simintpay',
};

// Mantida para quando a coluna "Saldo líquido" (comentada na tabela de Leads) voltar.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/**
 * Escolhe QUAL plataforma a ação atinge (ou todas). Mostrar os nomes é essencial:
 * com "só esta plataforma" genérico, o master confirmava sem saber qual das 3
 * seria afetada. Com 1 plataforma, não há escolha — só destaca qual é.
 */
function AlvoPicker({
  entries,
  value,
  onChange,
  disabled,
  tom,
}: {
  entries: PlatformEntry[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Cor de destaque da opção "todas" — vermelho ao inativar, verde ao reativar. */
  tom: 'perigo' | 'ok';
}) {
  const lista = entries ?? [];

  if (lista.length <= 1) {
    const e = lista[0];
    return (
      <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          Plataforma afetada
        </p>
        {e ? (
          <span
            className={`mt-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getPlatformBadgeClass(e.platform)}`}
          >
            {PLATFORM_LABELS[e.platform.toLowerCase()] ?? e.platform}
          </span>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">A conta inteira</p>
        )}
      </div>
    );
  }

  const todasAtiva = value === 'todas';
  const corTodas =
    tom === 'perigo'
      ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-400'
      : 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-400';

  return (
    <div className="mt-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        Escolha a plataforma ({lista.length} vinculadas)
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {lista.map((e) => (
          <button
            key={e.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(e.id)}
            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition disabled:opacity-50 ${
              value === e.id
                ? 'border-violet-400 bg-violet-50 dark:border-violet-400/40 dark:bg-violet-500/10'
                : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'
            }`}
          >
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getPlatformBadgeClass(e.platform)}`}
            >
              {PLATFORM_LABELS[e.platform.toLowerCase()] ?? e.platform}
            </span>
            {value === e.id && (
              <CheckCircle2 size={14} className="text-violet-500" />
            )}
          </button>
        ))}

        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('todas')}
          className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-semibold transition disabled:opacity-50 ${
            todasAtiva
              ? corTodas
              : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
          }`}
        >
          Todas as {lista.length} plataformas
          {todasAtiva && <CheckCircle2 size={14} />}
        </button>
      </div>
    </div>
  );
}

// Estado da varredura automática (módulo): sobrevive a troca de aba dentro de /admin/contas.
const SCAN_COOLDOWN_MS = 5 * 60 * 1000;
let lastScanAt = 0;
let scanInFlight = false;

const ICON_ACTION_TONES = {
  neutral:
    'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10',
  emerald:
    'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20',
  violet:
    'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20',
  amber:
    'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20',
  red: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20',
  redStrong:
    'border-red-300 bg-red-100 text-red-700 hover:bg-red-200 dark:border-red-500/30 dark:bg-red-500/20 dark:text-red-300 dark:hover:bg-red-500/30',
} as const;

/** Botão de ação só com ícone; o rótulo aparece no tooltip e vira aria-label. */
function IconAction({
  label,
  tone,
  onClick,
  disabled,
  children,
}: {
  label: string;
  tone: keyof typeof ICON_ACTION_TONES;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <PortalTooltip
      content={
        <div className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {label}
        </div>
      }
    >
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-50',
          ICON_ACTION_TONES[tone],
        )}
      >
        {children}
      </button>
    </PortalTooltip>
  );
}

export default function UsuariosTab({
  refreshKey = 0,
}: {
  refreshKey?: number;
}) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const { user, loading: loadingUser } = useCurrentUser();
  const isMaster = Boolean(user?.isMasterAdmin);

  const [chargeClient, setChargeClient] = useState<ChargeClient | null>(null);

  const [items, setItems] = useState<ExternalUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [platform, setPlatform] = useState('');
  const [search, setSearch] = useState('');
  // 'active' = aprovados + pendentes (padrão); 'rejected' = solicitações rejeitadas.
  const [requestFilter, setRequestFilter] = useState<'active' | 'rejected'>(
    'active',
  );
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadActionId, setLeadActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const showDeleted = false;
  const showPurged = false;
  const [accessingId, setAccessingId] = useState<string | null>(null);
  const [confirmDeleteUser, setConfirmDeleteUser] =
    useState<ExternalUser | null>(null);
  const [confirmReactivateUser, setConfirmReactivateUser] =
    useState<ExternalUser | null>(null);
  const [confirmPurgeUser, setConfirmPurgeUser] = useState<ExternalUser | null>(
    null,
  );
  const [carteiraUser, setCarteiraUser] = useState<ExternalUser | null>(null);
  const { platforms: catalogPlatforms } = useProductPlatforms();
  const platformNameByTag = new Map(
    catalogPlatforms.map((p) => [p.tag.trim().toLowerCase(), p.name]),
  );
  const platformName = (tag: string) =>
    platformNameByTag.get(tag.trim().toLowerCase()) ??
    PLATFORM_LABELS[tag.toLowerCase()] ??
    tag;
  const platformBalances = (carteiraUser?.balanceAttribution ?? []).filter(
    (a): a is typeof a & { platformTag: string } => Boolean(a.platformTag),
  );
  const [purging, setPurging] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  /**
   * Alvo da ação: o `id` da entrada de plataforma escolhida, ou "todas".
   * Com 1 plataforma já vem escolhida; com várias, fica vazio até o master decidir
   * (assim ninguém confirma sem saber qual plataforma será afetada).
   */
  const [alvo, setAlvo] = useState<string>('');

  function abrirInativar(u: ExternalUser) {
    setAlvo(u.platformEntries?.length === 1 ? u.platformEntries[0].id : '');
    setConfirmDeleteUser(u);
  }

  function abrirReativar(u: ExternalUser) {
    setAlvo(u.platformEntries?.length === 1 ? u.platformEntries[0].id : '');
    setConfirmReactivateUser(u);
  }

  function abrirPurge(u: ExternalUser) {
    setAlvo(u.platformEntries?.length === 1 ? u.platformEntries[0].id : '');
    setConfirmPurgeUser(u);
  }
  const [deleting, setDeleting] = useState(false);
  const [editUser, setEditUser] = useState<ExternalUser | null>(null);
  const [editForm, setEditForm] = useState({ name: '', cpf: '', email: '' });
  const [saving, setSaving] = useState(false);
  const searchMountedRef = useRef(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'todas' | 'plataforma'>(
    'todas',
  );
  const [exportPlatform, setExportPlatform] = useState('');
  const [exportPeriod, setExportPeriod] = useState<
    'mensal' | 'trimestral' | 'semestral' | 'anual'
  >('mensal');
  const [exporting, setExporting] = useState(false);
  const [markingCompanyId, setMarkingCompanyId] = useState<string | null>(null);

  function getApi() {
    const token = localStorage.getItem('access_token');
    return createApiClient({
      baseUrl: getDefaultApiBaseUrl(),
      getToken: () => token ?? undefined,
    });
  }

  async function marcarComoEmpresa(u: ExternalUser) {
    if (!u.simpayUser) return;
    setMarkingCompanyId(u.simpayUser.id);
    try {
      const api = getApi();
      await api.patch(endpoints.admin.usuarios.marcarEmpresa(u.simpayUser.id), {
        isCompany: true,
      });
      toast({
        type: 'success',
        title: 'Movido para Clientes',
        description: `${u.name} agora aparece na listagem de clientes SimintPay.`,
      });
      fetchUsers();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Não foi possível marcar como empresa.',
      });
    } finally {
      setMarkingCompanyId(null);
    }
  }

  async function acessarComo(u: ExternalUser) {
    if (!u.simpayUser) return;
    setAccessingId(u.simpayUser.id);
    try {
      const res = await getApi().post<{
        accessToken: string;
        expiresIn?: number;
      }>(endpoints.admin.usuarios.acessarComo(u.simpayUser.id), {});
      startImpersonation(res.accessToken, res.expiresIn ?? 2 * 60 * 60);
      window.location.assign('/painel');
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Não foi possível acessar como este usuário.',
      });
      setAccessingId(null);
    }
  }

  const fetchUsers = useCallback(
    async (
      p = page,
      plat = platform,
      deleted = showDeleted,
      q = search,
      purged = showPurged,
    ) => {
      try {
        const api = getApi();
        const params = new URLSearchParams({
          page: String(p),
          pageSize: String(pageSize),
          ...(plat ? { platform: plat } : {}),
          ...(purged ? { purged: 'true' } : deleted ? { deleted: 'true' } : {}),
          ...(q.trim() ? { search: q.trim() } : {}),
        });
        const res = await api.get<ApiResponse>(
          `${endpoints.admin.usuarios.list}?${params}`,
        );
        setItems(res.data ?? []);
        setTotal(res.total ?? 0);
      } catch (err: unknown) {
        toast({
          type: 'error',
          title: 'Erro',
          description:
            (err instanceof Error ? err.message : undefined) ??
            'Erro ao carregar leads.',
        });
      } finally {
        setLoading(false);
      }
    },
    [page, platform, showDeleted, showPurged, search],
  );

  const fetchLeads = useCallback(
    async (filter = requestFilter) => {
      try {
        const res = await getApi().get<{ data?: Lead[] }>(
          endpoints.admin.leads.list,
          {
            query: {
              page: 1,
              pageSize: 200,
              status: filter === 'rejected' ? 'REJECTED' : 'PENDING',
            },
          },
        );
        setLeads(res.data ?? []);
      } catch {
        setLeads([]);
      }
    },
    [requestFilter],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!loadingUser && user?.isAdmin) void fetchLeads(requestFilter);
  }, [requestFilter, loadingUser, refreshKey]);

  async function decideLead(lead: Lead, action: 'approve' | 'reject') {
    setLeadActionId(lead.id);
    try {
      const path =
        action === 'approve'
          ? endpoints.admin.leads.approve(lead.id)
          : endpoints.admin.leads.reject(lead.id);
      await getApi().post(path, {});
      toast({
        type: 'success',
        title:
          action === 'approve'
            ? 'Solicitação aprovada'
            : 'Solicitação rejeitada',
      });
      await Promise.all([fetchLeads(), fetchUsersRef.current()]);
    } catch {
      toast({
        type: 'error',
        title: action === 'approve' ? 'Erro ao aprovar' : 'Erro ao rejeitar',
        description: 'Tente novamente.',
      });
    } finally {
      setLeadActionId(null);
    }
  }

  // Sempre aponta pro fetchUsers mais recente (a varredura termina bem depois do render que a iniciou).
  const fetchUsersRef = useRef(fetchUsers);
  useEffect(() => {
    fetchUsersRef.current = fetchUsers;
  }, [fetchUsers]);

  useEffect(() => {
    if (!loadingUser && user?.isAdmin) {
      fetchUsers(page, platform, showDeleted, search, showPurged);
    }
  }, [page, platform, showDeleted, showPurged, loadingUser, refreshKey]);

  useEffect(() => {
    if (!searchMountedRef.current) {
      searchMountedRef.current = true;
      return;
    }
    if (loadingUser || !user?.isAdmin) return;
    const timer = setTimeout(() => {
      setPage(1);
      fetchUsers(1, platform, showDeleted, search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  /**
   * Varredura automática de donos de plataforma: roda ao abrir a tela (em segundo plano,
   * sem bloquear a lista) e no máximo 1x a cada SCAN_COOLDOWN_MS por sessão do navegador.
   * Só avisa o usuário quando de fato criou/vinculou contas; falhas ficam silenciosas
   * porque a lista continua válida com o saldo ao vivo.
   */
  async function runAutoScan() {
    const now = Date.now();
    if (scanInFlight || now - lastScanAt < SCAN_COOLDOWN_MS) return;
    scanInFlight = true;
    try {
      const api = getApi();
      const res = await api.post<{
        data: {
          scanned: number;
          created: number;
          linked: number;
          walletsUpdated: number;
        };
      }>(endpoints.admin.usuarios.scan, {});
      lastScanAt = Date.now();
      const d = res.data;
      if (d.created > 0 || d.linked > 0) {
        toast({
          type: 'success',
          title: 'Contas sincronizadas',
          description: `${d.created} novos • ${d.linked} vinculados`,
        });
      }
      if (d.created > 0 || d.linked > 0 || d.walletsUpdated > 0) {
        fetchUsersRef.current();
      }
    } catch {
      // silencioso: a próxima abertura da tela tenta de novo
    } finally {
      scanInFlight = false;
      setScanning(false);
    }
  }

  // Varredura automática ao entrar na tela (uma vez por montagem; respeita o cooldown).
  useEffect(() => {
    if (!loadingUser && user?.isAdmin) void runAutoScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingUser, user?.isAdmin]);

  async function handleExport() {
    setExporting(true);
    try {
      const api = getApi();
      const params = new URLSearchParams({ period: exportPeriod });
      if (exportScope === 'plataforma' && exportPlatform)
        params.set('platform', exportPlatform);

      const data = await api.get<
        Array<{
          nome: string;
          cpf: string;
          plataforma: string;
          saldo: number | null;
          saldoBloqueado: number | null;
          walletScope: string;
          balanceStatus: string;
          historicalAttributionComplete: boolean;
          walletStatus: string;
          vinculado: boolean;
          status: string;
          email: string;
          cadastro: string;
        }>
      >(`${endpoints.admin.usuarios.export}?${params}`);

      const header = [
        'Nome',
        'CPF/CNPJ',
        'Plataformas',
        'Saldo (R$)',
        'Saldo Bloqueado (R$)',
        'Vinculado',
        'Status',
        'E-mail Simintpay',
        'Data Cadastro',
        'Escopo do saldo',
        'Status do saldo',
        'Histórico atribuído completo',
        'Status da carteira',
      ];
      const rows = data.map((u) => [
        u.nome,
        u.cpf,
        u.plataforma,
        u.saldo?.toFixed(2).replace('.', ',') ?? 'Indisponível',
        u.saldoBloqueado?.toFixed(2).replace('.', ',') ?? 'Indisponível',
        u.vinculado ? 'Sim' : 'Não',
        u.status,
        u.email,
        u.cadastro,
        u.walletScope,
        u.balanceStatus,
        u.historicalAttributionComplete ? 'Sim' : 'Não',
        u.walletStatus,
      ]);
      const quoteCell = (value: string) =>
        `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
      const csv =
        '﻿' +
        [header, ...rows].map((r) => r.map(quoteCell).join(';')).join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const scope =
        exportScope === 'plataforma' && exportPlatform
          ? exportPlatform
          : 'todas-plataformas';
      a.href = url;
      a.download = `leads-${scope}-${exportPeriod}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro ao exportar',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setExporting(false);
    }
  }

  function openEdit(u: ExternalUser) {
    setEditUser(u);
    setEditForm({
      name: u.name,
      cpf: formatDocument(u.cpf),
      email: u.simpayUser?.email ?? '',
    });
  }

  async function handleSave() {
    if (!editUser) return;
    setSaving(true);
    try {
      const api = getApi();
      await api.patch(endpoints.admin.usuarios.update(editUser.id), {
        name: editForm.name.trim() || undefined,
        cpf: editForm.cpf.replace(/\D/g, '') || undefined,
      });
      toast({
        type: 'success',
        title: 'Dados atualizados',
        description: 'As informações foram salvas com sucesso.',
      });
      setEditUser(null);
      fetchUsers(page, platform, showDeleted, search);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro ao salvar',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setSaving(false);
    }
  }

  /** Traduz o `alvo` escolhido no modal para (id da entrada, escopo) da API. */
  function resolverAlvo(
    u: ExternalUser,
  ): { id: string; escopo: 'plataforma' | 'todas' } | null {
    if (!alvo) return null;
    if (alvo === 'todas') {
      // Em "todas", o backend expande a partir de qualquer entrada do mesmo CPF/CNPJ.
      return { id: u.platformEntries?.[0]?.id ?? u.id, escopo: 'todas' };
    }
    return { id: alvo, escopo: 'plataforma' };
  }

  function nomePlataforma(u: ExternalUser, entryId: string): string {
    const e = u.platformEntries?.find((p) => p.id === entryId);
    if (!e) return 'esta plataforma';
    return PLATFORM_LABELS[e.platform.toLowerCase()] ?? e.platform;
  }

  async function handleDelete() {
    const u = confirmDeleteUser;
    const resolvido = u && resolverAlvo(u);
    if (!u || !resolvido) return;

    setDeleting(true);
    try {
      const api = getApi();
      await api.delete(
        `${endpoints.admin.usuarios.delete(resolvido.id)}?escopo=${resolvido.escopo}`,
      );
      toast({
        type: 'success',
        title: 'Conta inativada',
        description:
          resolvido.escopo === 'todas'
            ? 'Inativada em todas as plataformas. O saldo foi preservado.'
            : `Inativada em ${nomePlataforma(u, resolvido.id)}. As demais seguem ativas e o saldo foi preservado.`,
      });
      setConfirmDeleteUser(null);
      setAlvo('');
      fetchUsers(page, platform, showDeleted, search);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro ao inativar',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setDeleting(false);
    }
  }

  async function handleReactivate() {
    const u = confirmReactivateUser;
    const resolvido = u && resolverAlvo(u);
    if (!u || !resolvido) return;

    setReactivating(true);
    try {
      const api = getApi();
      await api.post(
        `${endpoints.admin.usuarios.reativar(resolvido.id)}?escopo=${resolvido.escopo}`,
        {},
      );
      toast({
        type: 'success',
        title: 'Conta reativada',
        description:
          resolvido.escopo === 'todas'
            ? 'Reativada em todas as plataformas. O saldo voltou intacto.'
            : `Reativada em ${nomePlataforma(u, resolvido.id)}. O saldo voltou intacto.`,
      });
      setConfirmReactivateUser(null);
      setAlvo('');
      fetchUsers(page, platform, showDeleted, search);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro ao reativar',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setReactivating(false);
    }
  }

  async function handlePurge() {
    const u = confirmPurgeUser;
    if (!u || !alvo) return;
    const { todas, id } = (() => {
      const t = alvo === 'todas';
      return { todas: t, id: t ? (u.platformEntries?.[0]?.id ?? u.id) : alvo };
    })();
    setPurging(true);
    try {
      const api = getApi();
      const res = await api.delete<{ saldoAbsorvido?: number }>(
        `${endpoints.admin.usuarios.permanente(id)}?escopo=${todas ? 'todas' : 'plataforma'}`,
      );
      toast({
        type: 'success',
        title: 'Conta excluída permanentemente',
        description: `Saldo absorvido pelo master: ${formatCurrency(Number(res?.saldoAbsorvido ?? 0))}.`,
      });
      setConfirmPurgeUser(null);
      setAlvo('');
      fetchUsers(page, platform, showDeleted, search, showPurged);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erro ao excluir',
        description:
          (err instanceof Error ? err.message : undefined) ??
          'Tente novamente.',
      });
    } finally {
      setPurging(false);
    }
  }

  const filtered = requestFilter === 'rejected' ? [] : items;

  // Solicitações pendentes (ou rejeitadas) ficam sempre acima, em ordem alfabética.
  const leadTerm = search.trim().toLowerCase();
  const visibleLeads = platform
    ? []
    : leads
        .filter((l) =>
          leadTerm
            ? [l.name, l.email, l.razaoSocial, l.cnpj, l.cpf ?? '']
                .join(' ')
                .toLowerCase()
                .includes(leadTerm)
            : true,
        )
        .sort((a, b) =>
          (a.razaoSocial || a.name).localeCompare(
            b.razaoSocial || b.name,
            'pt-BR',
          ),
        );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const colSpan = 6; // Ambas as abas têm a coluna "Ações" (reativar na de excluídas)

  if (!loadingUser && !user?.isAdmin) {
    router.replace('/painel');
    return null;
  }

  if (loadingUser || !user?.isAdmin) return null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        .leads-page { font-family: 'Inter', sans-serif; }
      `}</style>

      {/* Export modal */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Exportar CSV
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Escolha o escopo e o período.
            </p>

            <div className="mt-4 flex flex-col gap-4">
              {/* Escopo */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Plataformas
                </span>
                <div className="flex gap-2">
                  {(['todas', 'plataforma'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setExportScope(s)}
                      className={cn(
                        'flex-1 rounded-xl border py-2 text-xs font-medium transition',
                        exportScope === s
                          ? 'border-violet-500 bg-violet-600 text-white'
                          : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300',
                      )}
                    >
                      {s === 'todas'
                        ? 'Todas as plataformas'
                        : 'Plataforma específica'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Seletor de plataforma específica */}
              {exportScope === 'plataforma' && (
                <div className="flex flex-col gap-1.5">
                  <PlatformFilterSelect
                    hideOwner
                    theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                    label="Plataforma"
                    value={exportPlatform}
                    onChange={(value) => setExportPlatform(value.toLowerCase())}
                    placeholder="Selecione uma plataforma"
                    options={Object.entries(PLATFORM_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </div>
              )}

              {/* Período */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Período
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: 'mensal', label: 'Mensal' },
                      { value: 'trimestral', label: 'Trimestral' },
                      { value: 'semestral', label: 'Semestral' },
                      { value: 'anual', label: 'Anual' },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setExportPeriod(p.value)}
                      className={cn(
                        'rounded-xl border py-2 text-xs font-medium transition',
                        exportPeriod === p.value
                          ? 'border-violet-500 bg-violet-600 text-white'
                          : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setExportOpen(false)}
                disabled={exporting}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleExport}
                disabled={
                  exporting || (exportScope === 'plataforma' && !exportPlatform)
                }
                className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
              >
                {exporting ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )}
                {exporting ? 'Exportando...' : 'Baixar CSV'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Editar lead
            </h2>
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-500/10">
              <span className="mt-px text-amber-500 shrink-0">⚠</span>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                As alterações feitas aqui afetam{' '}
                <strong>somente o Simintpay</strong>. Os dados na plataforma de
                origem do usuário não são alterados.
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Nome
                </span>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  CPF/CNPJ
                </span>
                <input
                  type="text"
                  value={editForm.cpf}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, cpf: e.target.value }))
                  }
                  className="h-9 rounded-xl border border-zinc-200 bg-white px-3 font-mono text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
                />
              </label>
              {editUser.simpayUser && (
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-white/5 dark:bg-white/5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                    Conta Simintpay vinculada
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
                    {editUser.simpayUser.email}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    E-mail de login — não editável por aqui
                  </p>
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEditUser(null)}
                disabled={saving}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
              >
                {saving ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : null}
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDeleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Inativar conta
            </h2>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              {confirmDeleteUser.name}
            </p>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              A conta vai para <strong>Contas inativas</strong> e pode ser
              reativada depois. O <strong>saldo é preservado</strong> e volta ao
              reativar.
            </p>

            <AlvoPicker
              entries={confirmDeleteUser.platformEntries ?? []}
              value={alvo}
              onChange={setAlvo}
              disabled={deleting}
              tom="perigo"
            />

            <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
              {alvo === 'todas'
                ? 'O acesso sai de todas as plataformas deste CPF/CNPJ e o login é desativado.'
                : 'Só a plataforma escolhida é afetada. Havendo outras ativas, o login continua funcionando.'}
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmDeleteUser(null);
                  setAlvo('');
                }}
                disabled={deleting}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || !alvo}
                title={
                  !alvo ? 'Escolha qual plataforma será afetada' : undefined
                }
                className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
              >
                {deleting ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
                {deleting ? 'Inativando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm reactivate modal */}
      {confirmReactivateUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Reativar conta
            </h2>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              {confirmReactivateUser.name}
            </p>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              A conta volta a ficar ativa e o cliente recupera o acesso. O{' '}
              <strong>saldo volta intacto</strong>.
            </p>

            <AlvoPicker
              entries={confirmReactivateUser.platformEntries ?? []}
              value={alvo}
              onChange={setAlvo}
              disabled={reactivating}
              tom="ok"
            />

            <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
              {alvo === 'todas'
                ? 'Reativa em todas as plataformas inativas deste CPF/CNPJ.'
                : 'Reativa só a plataforma escolhida. As demais continuam como estão.'}
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmReactivateUser(null);
                  setAlvo('');
                }}
                disabled={reactivating}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleReactivate}
                disabled={reactivating || !alvo}
                title={
                  !alvo ? 'Escolha qual plataforma será reativada' : undefined
                }
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                {reactivating ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                {reactivating ? 'Reativando...' : 'Confirmar reativação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm permanent-delete modal */}
      {confirmPurgeUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-red-200 bg-white p-6 shadow-2xl dark:border-red-500/30 dark:bg-zinc-900">
            <h2 className="flex items-center gap-2 text-base font-semibold text-red-700 dark:text-red-400">
              <Trash2 size={16} />
              Excluir permanentemente
            </h2>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              {confirmPurgeUser.name}
            </p>

            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-500/20 dark:bg-red-500/10">
              <p className="text-sm text-red-700 dark:text-red-300">
                Ação <strong>irreversível</strong>. A conta não poderá ser
                reativada.
              </p>
              <p className="mt-1.5 text-sm text-red-700 dark:text-red-300">
                O saldo de{' '}
                <strong>{formatCurrency(confirmPurgeUser.balance ?? 0)}</strong>{' '}
                será <strong>absorvido pelo master</strong>.
              </p>
            </div>

            <AlvoPicker
              entries={confirmPurgeUser.platformEntries ?? []}
              value={alvo}
              onChange={setAlvo}
              disabled={purging}
              tom="perigo"
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmPurgeUser(null);
                  setAlvo('');
                }}
                disabled={purging}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={handlePurge}
                disabled={purging || !alvo}
                title={
                  !alvo ? 'Escolha qual plataforma será excluída' : undefined
                }
                className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
              >
                {purging ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
                {purging ? 'Excluindo...' : 'Excluir permanentemente'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="leads-page flex flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          {/* Busca */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="text"
              placeholder="Nome, CPF ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-4 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
          </div>

          <PlatformFilterSelect
            hideOwner
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            placeholder="Plataforma"
            value={platform}
            onChange={(value) => {
              setPlatform(value.toLowerCase());
              setPage(1);
            }}
            options={[
              { value: '', label: 'Todas as plataformas' },
              ...Object.entries(PLATFORM_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            className="h-9 min-w-[220px] rounded-xl text-sm"
          />

          <Dropdown
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            placeholder="Solicitação"
            value={requestFilter}
            onChange={(value) => {
              setRequestFilter(value === 'rejected' ? 'rejected' : 'active');
              setPage(1);
            }}
            options={[
              { value: 'active', label: 'Padrão' },
              { value: 'rejected', label: 'Rejeitados' },
            ]}
            className="h-9 min-w-[200px] rounded-xl text-sm"
          />

          {/* Refresh */}
          <button
            onClick={() => {
              void fetchLeads();
              fetchUsers(page, platform, showDeleted, search);
            }}
            disabled={loading}
            className="flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>

          {/* Exportar CSV */}
          {!showDeleted && (
            <button
              onClick={() => setExportOpen(true)}
              className="flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
            >
              <Download size={14} />
              Exportar CSV
            </button>
          )}

          {scanning && (
            <span className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
              <RefreshCw size={12} className="animate-spin" />
              Sincronizando contas...
            </span>
          )}
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-white/10">
                <th className="px-4 py-3 text-left font-semibold text-zinc-500 dark:text-zinc-400">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500 dark:text-zinc-400">
                  Contato
                </th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500 dark:text-zinc-400">
                  Empresa
                </th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500 dark:text-zinc-400">
                  Plataformas
                </th>
                {/* Coluna "Saldo líquido" comentada temporariamente — pode voltar futuramente.
                <th className="px-4 py-3 text-right font-semibold text-zinc-500 dark:text-zinc-400">Saldo líquido</th>
                */}
                <th className="px-4 py-3 text-center font-semibold text-zinc-500 dark:text-zinc-400">
                  <span className="inline-flex items-center justify-center gap-1">
                    Vinculado
                    <HelpTooltip>
                      Indica se o lead possui uma conta ativa na Simintpay
                      vinculada ao CPF cadastrado. Usuários vinculados podem
                      solicitar saques e acessar o painel.
                    </HelpTooltip>
                  </span>
                </th>
                {/* Coluna "Atividade" (transacionou no mês corrente) comentada temporariamente — confundia com o status da aba (ativo/inativo). */}
                <th className="px-4 py-3 text-center font-semibold text-zinc-500 dark:text-zinc-400">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="px-4 py-12 text-center text-zinc-400 dark:text-zinc-500"
                  >
                    <RefreshCw
                      size={20}
                      className="mx-auto animate-spin mb-2"
                    />
                    Carregando...
                  </td>
                </tr>
              ) : filtered.length === 0 && visibleLeads.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="px-4 py-12 text-center text-zinc-400 dark:text-zinc-500"
                  >
                    {showDeleted
                      ? 'Nenhuma conta inativa.'
                      : 'Nenhum lead encontrado.'}
                  </td>
                </tr>
              ) : (
                <>
                  {visibleLeads.map((l) => (
                    <tr
                      key={`lead-${l.id}`}
                      className="border-b border-zinc-50 bg-amber-50/40 transition hover:bg-amber-50/70 dark:border-white/5 dark:bg-amber-500/5"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {l.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                        <div>{l.email}</div>
                        <div className="text-xs text-zinc-400">{l.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-800 dark:text-zinc-200">
                          {l.razaoSocial || '—'}
                        </div>
                        <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                          {formatDocument(l.cnpj)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                            l.status === 'REJECTED'
                              ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
                          )}
                        >
                          {l.status === 'REJECTED' ? 'Rejeitado' : 'Pendente'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-zinc-400">—</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {l.status === 'PENDING' && (
                            <>
                              <IconAction
                                label="Aprovar"
                                tone="emerald"
                                disabled={leadActionId === l.id}
                                onClick={() => decideLead(l, 'approve')}
                              >
                                <CheckCircle2 size={14} />
                              </IconAction>
                              <IconAction
                                label="Rejeitar"
                                tone="red"
                                disabled={leadActionId === l.id}
                                onClick={() => decideLead(l, 'reject')}
                              >
                                <XCircle size={14} />
                              </IconAction>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-zinc-50 last:border-0 transition hover:bg-zinc-50/50 dark:border-white/5 dark:hover:bg-white/5"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {u.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                        <div>{u.simpayUser?.email || '—'}</div>
                        {u.simpayUser?.phone && (
                          <div className="text-xs text-zinc-400">
                            {u.simpayUser.phone}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {u.simpayUser?.isCompany && (
                          <div className="font-medium text-zinc-800 dark:text-zinc-200">
                            {u.simpayUser.name}
                          </div>
                        )}
                        <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                          {formatDocument(u.cpf)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <AccountPlatformsButton
                          name={u.name}
                          entries={u.platformEntries ?? []}
                        />
                      </td>
                      {/* Coluna "Saldo líquido" comentada temporariamente — pode voltar futuramente.
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold tabular-nums ${u.balance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                        {formatCurrency(u.balance)}
                      </span>
                    </td>
                    */}
                      <td className="px-4 py-3 text-center">
                        {u.vinculado ? (
                          <CheckCircle2
                            size={16}
                            className="mx-auto text-emerald-500"
                          />
                        ) : (
                          <XCircle
                            size={16}
                            className="mx-auto text-zinc-300 dark:text-zinc-600"
                          />
                        )}
                      </td>
                      {/* Coluna "Atividade" (transacionou no mês corrente) comentada temporariamente — confundia com o status da aba (ativo/inativo).
                    <td className="px-4 py-3 text-center">
                      {u.isAtivo === null ? (
                        <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                          —
                        </span>
                      ) : u.isAtivo ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-500/15 dark:text-red-400">
                          Inativo
                        </span>
                      )}
                    </td>
                    */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {showPurged ? (
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                              Excluída permanentemente
                            </span>
                          ) : u.isDeleted ? (
                            <>
                              <IconAction
                                label="Reativar"
                                tone="emerald"
                                onClick={() => abrirReativar(u)}
                              >
                                <CheckCircle2 size={14} />
                              </IconAction>
                              <IconAction
                                label="Excluir permanente"
                                tone="redStrong"
                                onClick={() => abrirPurge(u)}
                              >
                                <Trash2 size={14} />
                              </IconAction>
                            </>
                          ) : (
                            <>
                              {isMaster && u.simpayUser && (
                                <IconAction
                                  label="Acessar como"
                                  tone="amber"
                                  disabled={accessingId === u.simpayUser.id}
                                  onClick={() => acessarComo(u)}
                                >
                                  <DoorOpen size={14} />
                                </IconAction>
                              )}
                              {u.simpayUser && (
                                <IconAction
                                  label="Cobranças"
                                  tone="violet"
                                  onClick={() =>
                                    setChargeClient({
                                      id: u.simpayUser!.id,
                                      name: u.simpayUser!.name,
                                      email: u.simpayUser!.email,
                                      saldoDisponivel: u.balance,
                                    })
                                  }
                                >
                                  <Receipt size={14} />
                                </IconAction>
                              )}
                              <IconAction
                                label="Carteira"
                                tone="emerald"
                                onClick={() => setCarteiraUser(u)}
                              >
                                <Wallet size={14} />
                              </IconAction>
                              <IconAction
                                label="Editar"
                                tone="neutral"
                                onClick={() => openEdit(u)}
                              >
                                <Pencil size={14} />
                              </IconAction>
                              <IconAction
                                label="Excluir"
                                tone="red"
                                onClick={() => abrirInativar(u)}
                              >
                                <Trash2 size={14} />
                              </IconAction>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
            <span>
              {total} lead{total !== 1 ? 's' : ''} no total
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white transition hover:bg-zinc-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/5"
              >
                ‹
              </button>
              <span className="px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white transition hover:bg-zinc-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/5"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>

      {chargeClient && (
        <ClientChargesModal
          client={chargeClient}
          onClose={() => setChargeClient(null)}
          onChanged={() => {
            void fetchUsers();
          }}
        />
      )}

      {/* Carteira */}
      <Modal
        open={carteiraUser !== null}
        onClose={() => setCarteiraUser(null)}
        title="Carteira"
        maxWidth="max-w-sm"
      >
        {carteiraUser && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-white/5 dark:bg-white/5">
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {carteiraUser.name}
              </p>
              {carteiraUser.simpayUser?.email && (
                <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {carteiraUser.simpayUser.email}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(carteiraUser.platformEntries ?? []).map((p) => (
                  <span
                    key={p.id}
                    className={cn(
                      'rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
                      getPlatformBadgeClass(p.platform),
                    )}
                  >
                    {platformName(p.platform)}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Saldo total
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                  Disponível
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                  {formatCurrency(carteiraUser.balance ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                  Bloqueado
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                  {formatCurrency(carteiraUser.lockedBalance ?? 0)}
                </p>
              </div>
            </div>
            {platformBalances.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Saldo por plataforma
                </p>
                {platformBalances.map((a) => (
                  <div
                    key={a.platformTag}
                    className="flex items-center justify-between rounded-lg border border-zinc-100 px-3 py-1.5 text-sm dark:border-white/5"
                  >
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {platformName(a.platformTag)}
                    </span>
                    <span className="tabular-nums text-zinc-800 dark:text-zinc-200">
                      {formatCurrency((a.balanceCents ?? 0) / 100)}
                      {(a.pendingWithdrawalsGrossCents ?? 0) > 0 && (
                        <span className="ml-2 text-xs text-amber-600">
                          (
                          {formatCurrency(
                            (a.pendingWithdrawalsGrossCents ?? 0) / 100,
                          )}{' '}
                          bloq.)
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
