'use client';

import { PlatformFilterSelect } from '@/components/product-platforms/PlatformFilterSelect';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
  Users,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { DateRangePickerField } from '@/app/(dashboard)/relatorio/components/DateRangePickerField';
import type { DateRange } from '@/app/(dashboard)/relatorio/types';
import { BulkActionsBar } from '@/components/ui/BulkActionsBar';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';
import { TriCheckbox } from '@/components/ui/DataTable';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { useToast } from '@/components/ui/Toast';
import { useBulkSelect } from '@/hooks/use-bulk-select';
import { useColumnResize } from '@/hooks/use-column-resize';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';

const CHECKOUT_BASE_URL = (
  process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL ??
  'https://checkout.simintermediacoes.com'
).replace(/\/$/, '');

import { getPlatformBadgeClass } from '@/lib/utils';

function buildPixPlanCheckoutUrl(linkCode: string | null) {
  if (!linkCode) return null;
  const u = new URL(CHECKOUT_BASE_URL);
  u.searchParams.set('code', linkCode);
  return u.toString();
}

type PixPlanRow = {
  id: string;
  name: string;
  description: string;
  price: number;
  type: string;
  status: 'Ativo' | 'Inativo';
  linkCode: string | null;
  checkoutUrl: string | null;
  createdAt: string;
  cpfDono: string | null;
  donoNome: string | null;
  donoEmail: string | null;
  tenantTag: string | null;
  subscriberCount: number;
};

function CpfDonoCell({ row }: { row: PixPlanRow }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  if (!row.cpfDono) return <span className="text-zinc-400">—</span>;

  const showAbove = rect ? rect.bottom + 80 > window.innerHeight : false;
  const tooltipStyle: React.CSSProperties = rect
    ? showAbove
      ? {
          position: 'fixed',
          left: rect.left + rect.width / 2,
          top: rect.top - 6,
          transform: 'translateX(-50%) translateY(-100%)',
          zIndex: 9999,
        }
      : {
          position: 'fixed',
          left: rect.left + rect.width / 2,
          top: rect.bottom + 6,
          transform: 'translateX(-50%)',
          zIndex: 9999,
        }
    : {};

  return (
    <span
      ref={ref}
      className="cursor-default font-mono text-xs text-zinc-600 dark:text-zinc-300"
      onMouseEnter={() => setRect(ref.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={() => setRect(null)}
    >
      {row.cpfDono}
      {rect &&
        (row.donoNome || row.donoEmail) &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none max-w-xs rounded-xl border border-white/20 bg-zinc-900/95 px-3 py-2 shadow-xl backdrop-blur-md dark:bg-zinc-800/95"
            style={tooltipStyle}
          >
            {row.donoNome && (
              <p className="text-xs font-semibold text-zinc-100">
                {row.donoNome}
              </p>
            )}
            {row.donoEmail && (
              <p className="mt-0.5 text-xs text-zinc-400">{row.donoEmail}</p>
            )}
            <p className="mt-0.5 text-xs font-mono text-zinc-500">
              {row.cpfDono}
            </p>
          </div>,
          document.body,
        )}
    </span>
  );
}

type PixPlansListResponse = {
  items: {
    id: string;
    description?: string | null;
    price?: number | string;
    type?: string;
    status?: string;
    linkCode?: string | null;
    cpfDono?: string | null;
    donoNome?: string | null;
    donoEmail?: string | null;
    tenantTag?: string | null;
    subscriberCount?: number;
    createdAt?: string;
  }[];
  meta: {
    currentPage: number;
    itemsPerPage: number;
    totalItems: number;
    totalPages: number;
  };
};

function mapType(type?: string) {
  if (type === 'MONTHLY') return 'Mensal';
  if (type === 'TRIMESTRAL') return 'Trimestral';
  if (type === 'SEMESTRAL') return 'Semestral';
  if (type === 'ANUAL') return 'Anual';
  return type ?? '—';
}

/** Remove metadados internos `[CPF:...]` / `[NOME_DONO:...]` da descrição exibida na UI. */
function displayPlanoPixDescription(raw: string | null | undefined) {
  return (raw ?? '')
    .trim()
    .replace(/\s*\[CPF_DONO:[^\]]*\]/gi, '')
    .replace(/\s*\[CPF:[^\]]*\]/gi, '')
    .replace(/\s*\[TENANT:[^\]]*\]/gi, '')
    .replace(/\s*\[NOME_DONO:[^\]]*\]/gi, '')
    .replace(/\s+\d{11}\b/g, '')
    .replace(
      /\s+(pagatg|atlashosting|areaflix|bosque|renovada|ebooksim|frendz|revalida)\b/gi,
      '',
    )
    .trim();
}

function isActivePixPlanApiStatus(status: unknown) {
  const s = String(status ?? '').toUpperCase();
  return s === 'ACTIVE' || s === 'ATIVO' || s === 'ENABLED';
}

/** Filtro local quando a API não aplica `status` na listagem (além de refletir o dropdown imediatamente). */
function matchesPixPlanStatusFilter(
  item: { status?: unknown },
  applied: string,
) {
  if (applied === 'all') return true;
  const active = isActivePixPlanApiStatus(item.status);
  if (applied === 'Ativo') return active;
  if (applied === 'Inativo') return !active;
  return true;
}

function statusFromUrlParam(s: string | null): 'all' | 'Ativo' | 'Inativo' {
  const x = (s ?? 'all').toLowerCase();
  if (x === 'ativo') return 'Ativo';
  if (x === 'inativo') return 'Inativo';
  return 'all';
}

function statusToUrlParam(status: 'all' | 'Ativo' | 'Inativo'): string | null {
  if (status === 'Ativo') return 'ativo';
  if (status === 'Inativo') return 'inativo';
  return null;
}

/** Busca no nome exibido e na descrição bruta (a API pode não filtrar por trecho visível). */
function matchesPlanNameSearch(
  item: { description?: string | null },
  needle: string,
) {
  const t = needle.trim().toLowerCase();
  if (!t) return true;
  const raw = String(item.description ?? '').toLowerCase();
  const shown = displayPlanoPixDescription(item.description).toLowerCase();
  return raw.includes(t) || shown.includes(t);
}

function matchesClientSearch(
  item: {
    cpfDono?: string | null;
    donoNome?: string | null;
    donoEmail?: string | null;
  },
  needle: string,
) {
  const t = needle.trim().toLowerCase();
  if (!t) return true;
  return (
    (item.cpfDono ?? '').toLowerCase().includes(t) ||
    (item.donoNome ?? '').toLowerCase().includes(t) ||
    (item.donoEmail ?? '').toLowerCase().includes(t)
  );
}

function matchesDateRange(
  item: { createdAt?: string | null },
  from: string,
  to: string,
) {
  if (!from && !to) return true;
  if (!item.createdAt) return false;
  const d = new Date(item.createdAt).getTime();
  if (from && d < new Date(from + 'T00:00:00').getTime()) return false;
  if (to && d > new Date(to + 'T23:59:59.999').getTime()) return false;
  return true;
}

const ROWS_PER_PAGE = 20;

const PLATFORM_LABELS: Record<string, string> = {
  AREAFLIX: 'Áreaflix',
  EBOOK: 'EbookSim',
  ATLAS: 'AtlasHosting',
  PAGATG: 'PagaTG',
};

/**
 * A API atual quebra com `search` (Prisma: `contains` em campo `type` enum).
 * Com nome na URL, buscamos um lote sem `search` e filtramos no cliente.
 */
const PIX_PLAN_CLIENT_SEARCH_BATCH = 500;

function PlanosPixContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const searchApplied = searchParams.get('search')?.trim() ?? '';
  const statusApplied = statusFromUrlParam(searchParams.get('status'));
  const platformApplied = searchParams.get('platform')?.trim() ?? 'all';
  const clientApplied = searchParams.get('client')?.trim() ?? '';
  const dateFromApplied = searchParams.get('dateFrom')?.trim() ?? '';
  const dateToApplied = searchParams.get('dateTo')?.trim() ?? '';
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedCheckoutId, setCopiedCheckoutId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const bulk = useBulkSelect();
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  function copyLinkCode(id: string, code: string) {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  }

  function copyCheckout(id: string, url: string) {
    navigator.clipboard.writeText(url);
    setCopiedCheckoutId(id);
    setTimeout(
      () => setCopiedCheckoutId((prev) => (prev === id ? null : prev)),
      1500,
    );
  }

  const COL_DEFS = useMemo(
    () => [
      { key: '__select__', defaultWidth: 48 },
      { key: 'id', defaultWidth: 180 },
      { key: 'nome', defaultWidth: 200 },
      { key: 'plat', defaultWidth: 140 },
      { key: 'tipo', defaultWidth: 100 },
      { key: 'valor', defaultWidth: 110 },
      { key: 'status', defaultWidth: 90 },
      { key: 'assinantes', defaultWidth: 100 },
      { key: 'cpf', defaultWidth: 150 },
      { key: 'criadoPor', defaultWidth: 190 },
      { key: 'linkCode', defaultWidth: 150 },
      { key: 'checkout', defaultWidth: 110 },
      { key: 'criado', defaultWidth: 160 },
      { key: 'acoes', defaultWidth: 80 },
    ],
    [],
  );
  const { widths, onMouseDown } = useColumnResize(COL_DEFS);

  const replaceQuery = useCallback(
    (
      patch: Partial<{
        page: number;
        search: string;
        status: 'all' | 'Ativo' | 'Inativo';
        platform: string;
        client: string;
        dateFrom: string;
        dateTo: string;
      }>,
    ) => {
      const p = new URLSearchParams(searchParams.toString());
      if ('page' in patch) {
        if (patch.page! <= 1) p.delete('page');
        else p.set('page', String(patch.page));
      }
      if ('search' in patch) {
        const t = patch.search!.trim();
        if (!t) p.delete('search');
        else p.set('search', t);
      }
      if ('status' in patch) {
        const su = statusToUrlParam(patch.status!);
        if (su) p.set('status', su);
        else p.delete('status');
      }
      if ('platform' in patch) {
        if (!patch.platform || patch.platform === 'all') p.delete('platform');
        else p.set('platform', patch.platform);
      }
      if ('client' in patch) {
        const t = patch.client!.trim();
        if (!t) p.delete('client');
        else p.set('client', t);
      }
      if ('dateFrom' in patch) {
        if (!patch.dateFrom) p.delete('dateFrom');
        else p.set('dateFrom', patch.dateFrom);
      }
      if ('dateTo' in patch) {
        if (!patch.dateTo) p.delete('dateTo');
        else p.set('dateTo', patch.dateTo);
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () =>
          typeof window !== 'undefined'
            ? localStorage.getItem('access_token')
            : null,
      }),
    [],
  );

  const { data: taxasRes } = useQuery({
    queryKey: ['admin', 'platform-taxas'],
    queryFn: () =>
      api.get<{ data: Record<string, unknown> }>(
        endpoints.admin.plataformas.taxasList,
      ),
    staleTime: 5 * 60 * 1000,
  });
  const platformTags = useMemo(() => {
    if (!taxasRes?.data) return [];
    return Object.keys(taxasRes.data)
      .filter((t) => !['FRENDZ', 'REVALIDA'].includes(t.toUpperCase()))
      .sort();
  }, [taxasRes]);

  const nameSearchClientMode =
    searchApplied.trim().length > 0 ||
    clientApplied.trim().length > 0 ||
    !!dateFromApplied ||
    !!dateToApplied;

  const { data, isFetching } = useQuery({
    queryKey: [
      'pix-plans',
      nameSearchClientMode ? 'name-local' : page,
      nameSearchClientMode ? PIX_PLAN_CLIENT_SEARCH_BATCH : ROWS_PER_PAGE,
      searchApplied,
      statusApplied,
    ],
    queryFn: () =>
      api.get<PixPlansListResponse>(endpoints.planosPix.list, {
        query: {
          page: nameSearchClientMode ? 1 : page,

          limit: nameSearchClientMode
            ? PIX_PLAN_CLIENT_SEARCH_BATCH
            : ROWS_PER_PAGE,
          status:
            statusApplied === 'all'
              ? undefined
              : statusApplied === 'Ativo'
                ? 'ACTIVE'
                : 'INACTIVE',
        },
      }),
    staleTime: 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(endpoints.planosPix.delete(id)),
    onMutate: (id: string) => {
      queryClient.setQueriesData<PixPlansListResponse>(
        { queryKey: ['pix-plans'] },
        (old) => {
          if (!old) return old;
          return { ...old, items: old.items.filter((r) => r.id !== id) };
        },
      );
    },
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Plano PIX excluído',
        description: 'Plano PIX excluído com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['pix-plans'] });
      setConfirmDeleteId(null);
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível excluir o plano PIX.',
      });
      queryClient.invalidateQueries({ queryKey: ['pix-plans'] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => api.delete(endpoints.planosPix.delete(id))),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      return { ok, fail: results.length - ok };
    },
    onSuccess: ({ ok, fail }) => {
      queryClient.invalidateQueries({ queryKey: ['pix-plans'] });
      bulk.clear();
      setBulkConfirmOpen(false);
      if (fail === 0)
        toast({
          type: 'success',
          title: 'Planos PIX excluídos',
          description: `${ok} plano(s) PIX excluído(s).`,
        });
      else if (ok === 0)
        toast({
          type: 'error',
          title: 'Erro',
          description: `Não foi possível excluir os ${fail} plano(s) PIX selecionado(s).`,
        });
      else
        toast({
          type: 'success',
          title: 'Parcialmente excluído',
          description: `${ok} excluído(s), ${fail} falhou(aram).`,
        });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['pix-plans'] });
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível excluir os planos PIX selecionados.',
      });
    },
  });

  // Inativar/ativar — PATCH que alterna o status (backend já dá poder absoluto ao master).
  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(endpoints.planosPix.toggleStatus(id)),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Status atualizado',
        description: 'O status do plano PIX foi alterado.',
      });
      queryClient.invalidateQueries({ queryKey: ['pix-plans'] });
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível alterar o status do plano PIX.',
      });
    },
  });

  const handleAction = useCallback(
    (action: string, id: string) => {
      if (action === 'editar') {
        router.push(`/planos-pix/criar?id=${id}`);
      } else if (action === 'assinantes') {
        router.push(`/planos-pix/${id}/assinantes`);
      } else if (action === 'alternar-status') {
        toggleMutation.mutate(id);
      } else if (action === 'excluir') {
        setConfirmDeleteId(id);
      }
    },
    [deleteMutation, toggleMutation, router],
  );

  const filteredItems = useMemo(() => {
    return (data?.items ?? [])
      .filter((item) => matchesPixPlanStatusFilter(item, statusApplied))
      .filter((item) => matchesPlanNameSearch(item, searchApplied))
      .filter(
        (item) =>
          platformApplied === 'all' ||
          (item.tenantTag ?? '').toUpperCase() ===
            platformApplied.toUpperCase(),
      )
      .filter((item) => matchesClientSearch(item, clientApplied))
      .filter((item) => matchesDateRange(item, dateFromApplied, dateToApplied));
  }, [
    data?.items,
    statusApplied,
    searchApplied,
    platformApplied,
    clientApplied,
    dateFromApplied,
    dateToApplied,
  ]);

  const serverTotalPages = data?.meta?.totalPages ?? 1;
  const maxPage = nameSearchClientMode
    ? Math.max(1, Math.ceil(filteredItems.length / ROWS_PER_PAGE))
    : serverTotalPages;
  const effectivePage = nameSearchClientMode ? Math.min(page, maxPage) : page;

  useEffect(() => {
    if (!nameSearchClientMode || page <= maxPage) return;
    replaceQuery({ page: maxPage });
  }, [nameSearchClientMode, page, maxPage, replaceQuery]);

  const itemsForRows = useMemo(() => {
    if (!nameSearchClientMode) return filteredItems;
    const start = (effectivePage - 1) * ROWS_PER_PAGE;
    return filteredItems.slice(start, start + ROWS_PER_PAGE);
  }, [nameSearchClientMode, filteredItems, effectivePage]);

  const paginationPage = nameSearchClientMode ? effectivePage : page;

  const rows: PixPlanRow[] = useMemo(
    () =>
      itemsForRows.map((item) => {
        const shown =
          displayPlanoPixDescription(item.description) ||
          `Plano ${mapType(item.type)}`;
        return {
          id: item.id,
          name: shown,
          description: shown,
          price: Number(item.price ?? 0),
          type: mapType(item.type),
          status: isActivePixPlanApiStatus(item.status) ? 'Ativo' : 'Inativo',
          linkCode: item.linkCode ?? null,
          checkoutUrl: buildPixPlanCheckoutUrl(item.linkCode ?? null),
          cpfDono: item.cpfDono ?? null,
          donoNome: item.donoNome ?? null,
          donoEmail: item.donoEmail ?? null,
          tenantTag: item.tenantTag ?? null,
          subscriberCount: item.subscriberCount ?? 0,
          createdAt: item.createdAt
            ? new Date(item.createdAt).toLocaleString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })
            : '—',
        };
      }),
    [itemsForRows],
  );

  const totalPages = nameSearchClientMode ? maxPage : serverTotalPages;

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold">Planos por PIX</h1>
          <ActionButton
            variant="primary"
            onClick={() => router.push('/planos-pix/criar')}
          >
            <Plus className="h-4 w-4" />
            Criar plano PIX
          </ActionButton>
        </div>

        <div className="rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              theme={fieldTheme}
              variant="navbar"
              label="Nome do plano"
              placeholder="Ex: Plano PIX mensal"
              value={searchApplied}
              onChange={(v) => replaceQuery({ search: v, page: 1 })}
            />
            <Dropdown
              theme={fieldTheme}
              variant="navbar"
              portal
              label="Status"
              value={statusApplied}
              onChange={(v) => {
                replaceQuery({
                  status: v as 'all' | 'Ativo' | 'Inativo',
                  page: 1,
                });
              }}
              options={[
                { label: 'Todos', value: 'all' },
                { label: 'Ativo', value: 'Ativo' },
                { label: 'Inativo', value: 'Inativo' },
              ]}
            />
            <PlatformFilterSelect
              theme={fieldTheme}
              variant="navbar"
              portal
              label="Plataforma"
              value={platformApplied}
              onChange={(v) => replaceQuery({ platform: v, page: 1 })}
              options={[
                { label: 'Todas', value: 'all' },
                ...platformTags.map((tag) => ({
                  value: tag,
                  label: PLATFORM_LABELS[tag.toUpperCase()] ?? tag,
                })),
              ]}
            />
            <Input
              theme={fieldTheme}
              variant="navbar"
              label="Cliente (CPF / nome / e-mail)"
              placeholder="Ex: João ou 123.456.789-00"
              value={clientApplied}
              onChange={(v) => replaceQuery({ client: v, page: 1 })}
            />
            <DateRangePickerField
              label="Período"
              theme={fieldTheme}
              value={{
                start: dateFromApplied
                  ? new Date(dateFromApplied + 'T00:00:00')
                  : null,
                end: dateToApplied
                  ? new Date(dateToApplied + 'T23:59:59')
                  : null,
              }}
              onChange={(next: DateRange) =>
                replaceQuery({
                  dateFrom: next.start
                    ? next.start.toISOString().split('T')[0]
                    : '',
                  dateTo: next.end ? next.end.toISOString().split('T')[0] : '',
                  page: 1,
                })
              }
            />
          </div>
        </div>

        <BulkActionsBar
          count={bulk.count}
          deleting={bulkDeleteMutation.isPending}
          onClear={bulk.clear}
          onDelete={() => setBulkConfirmOpen(true)}
        />

        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/40 bg-zinc-50/50 shadow-[0_12px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <div className="flex-1 overflow-auto">
            <table
              style={{
                tableLayout: 'fixed',
                width: `${COL_DEFS.reduce((s, c) => s + (widths[c.key] ?? c.defaultWidth), 0)}px`,
                minWidth: '100%',
              }}
            >
              <colgroup>
                {COL_DEFS.map((c) => (
                  <col
                    key={c.key}
                    style={{ width: widths[c.key] ?? c.defaultWidth }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr className="sticky top-0 z-10 border-b border-white/40 bg-zinc-50/80 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950/80">
                  <th
                    style={{ width: widths['__select__'] ?? 48 }}
                    className="px-3 py-3 text-center align-middle"
                  >
                    <TriCheckbox
                      checked={
                        rows.length > 0 &&
                        rows.every((r) => bulk.selected.has(r.id))
                      }
                      indeterminate={
                        rows.some((r) => bulk.selected.has(r.id)) &&
                        !rows.every((r) => bulk.selected.has(r.id))
                      }
                      onChange={() => bulk.toggleAll(rows.map((r) => r.id))}
                      ariaLabel="Selecionar todos"
                    />
                  </th>
                  {(
                    [
                      { key: 'id', label: 'ID' },
                      { key: 'nome', label: 'Nome' },
                      { key: 'plat', label: 'Plataforma' },
                      { key: 'tipo', label: 'Tipo' },
                      { key: 'valor', label: 'Valor' },
                      { key: 'status', label: 'Status' },
                      { key: 'assinantes', label: 'Assinantes' },
                      { key: 'cpf', label: 'CPF Dono' },
                      { key: 'criadoPor', label: 'Criado por' },
                      { key: 'linkCode', label: 'Link Code' },
                      { key: 'checkout', label: 'Checkout' },
                      { key: 'criado', label: 'Criado em' },
                      { key: 'acoes', label: 'Ações' },
                    ] as const
                  ).map((col) => (
                    <th
                      key={col.key}
                      style={{
                        position: 'relative',
                        userSelect: 'none',
                        width: widths[col.key],
                      }}
                      className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500"
                    >
                      {col.label}
                      <span
                        onMouseDown={(e) => onMouseDown(col.key, e)}
                        className="absolute right-0 top-0 flex h-full w-3 cursor-col-resize items-center justify-center"
                        aria-hidden
                      >
                        <span className="h-4/5 w-px bg-zinc-300 dark:bg-zinc-600" />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/40 dark:divide-white/10">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`transition-colors hover:bg-zinc-950/5 dark:hover:bg-white/5 ${bulk.selected.has(row.id) ? 'bg-emerald-500/5' : ''}`}
                  >
                    <td className="px-3 py-3 text-center align-middle">
                      <TriCheckbox
                        checked={bulk.selected.has(row.id)}
                        onChange={() => bulk.toggle(row.id)}
                        ariaLabel="Selecionar linha"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.id}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.name}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {row.tenantTag ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${getPlatformBadgeClass(row.tenantTag)}`}
                        >
                          {(
                            {
                              SIMINTPAY: 'Sim Int Pay',
                              GLOBAL: 'Sim Int Pay',
                              AREAFLIX: 'Áreaflix',
                              EBOOKSIM: 'EbookSim',
                              EBOOK: 'EbookSim',
                              ATLAS: 'AtlasHosting',
                            } as Record<string, string>
                          )[row.tenantTag.toUpperCase()] ?? row.tenantTag}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.type}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.price.toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {row.status === 'Ativo' ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                          Inativo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        type="button"
                        onClick={() =>
                          router.push(`/planos-pix/${row.id}/assinantes`)
                        }
                        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                      >
                        <Users className="h-3 w-3" />
                        {row.subscriberCount}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <CpfDonoCell row={row} />
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-zinc-700 dark:text-zinc-200">
                          {row.donoNome ?? '—'}
                        </span>
                        {row.donoEmail && (
                          <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                            {row.donoEmail}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      <span className="inline-flex items-center gap-2">
                        {row.linkCode ?? '—'}
                        {row.linkCode ? (
                          <button
                            type="button"
                            title={
                              copiedId === row.id
                                ? 'Copiado!'
                                : 'Copiar link code'
                            }
                            onClick={() => copyLinkCode(row.id, row.linkCode!)}
                            className={
                              copiedId === row.id
                                ? 'text-emerald-500 transition-colors'
                                : 'text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200'
                            }
                          >
                            {copiedId === row.id ? (
                              <Check className="h-3.5 w-3.5 shrink-0" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 shrink-0" />
                            )}
                          </button>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.checkoutUrl ? (
                        <span className="inline-flex items-center gap-2">
                          <a
                            href={row.checkoutUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-500 hover:underline dark:text-emerald-400"
                            title="Abrir checkout Simintpay (plano PIX)"
                          >
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            Abrir
                          </a>
                          <button
                            type="button"
                            title={
                              copiedCheckoutId === row.id
                                ? 'Copiado!'
                                : 'Copiar URL do checkout'
                            }
                            onClick={() =>
                              copyCheckout(row.id, row.checkoutUrl!)
                            }
                            className={
                              copiedCheckoutId === row.id
                                ? 'text-emerald-500 transition-colors'
                                : 'text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200'
                            }
                          >
                            {copiedCheckoutId === row.id ? (
                              <Check className="h-3.5 w-3.5 shrink-0" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 shrink-0" />
                            )}
                          </button>
                        </span>
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-500">
                          Gere o link code
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      {row.createdAt}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      <RowActionsMenu
                        rowId={row.id}
                        fieldTheme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                        ariaLabel="Ações do plano"
                        items={[
                          {
                            action: 'editar',
                            label: 'Editar',
                            icon: <Pencil className="h-4 w-4" />,
                            className:
                              resolvedTheme === 'dark'
                                ? 'text-zinc-200'
                                : 'text-slate-700',
                          },
                          {
                            action: 'assinantes',
                            label: 'Ver assinantes',
                            icon: <Users className="h-4 w-4" />,
                            className:
                              resolvedTheme === 'dark'
                                ? 'text-zinc-200'
                                : 'text-slate-700',
                          },
                          {
                            action: 'alternar-status',
                            label:
                              row.status === 'Ativo' ? 'Inativar' : 'Ativar',
                            icon:
                              row.status === 'Ativo' ? (
                                <PowerOff className="h-4 w-4" />
                              ) : (
                                <Power className="h-4 w-4" />
                              ),
                            className:
                              row.status === 'Ativo'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400',
                          },
                          {
                            action: 'excluir',
                            label: 'Excluir',
                            icon: <Trash2 className="h-4 w-4" />,
                            className: 'text-red-600 dark:text-red-400',
                          },
                        ]}
                        onAction={(action) => handleAction(action, row.id)}
                      />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={14}
                      className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
                    >
                      Nenhum plano PIX encontrado.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/40 bg-zinc-50/50 px-6 py-4 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              Página{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {paginationPage}
              </span>{' '}
              de{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {totalPages}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={paginationPage === 1}
                onClick={() => replaceQuery({ page: paginationPage - 1 })}
                className={[
                  'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all duration-200',
                  paginationPage > 1
                    ? 'border-zinc-200 bg-white text-zinc-700 hover:-translate-y-0.5 hover:bg-zinc-50 active:translate-y-0 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                    : 'cursor-not-allowed border-zinc-100 text-zinc-300 dark:border-white/5 dark:text-zinc-600',
                ].join(' ')}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={paginationPage === totalPages}
                onClick={() => replaceQuery({ page: paginationPage + 1 })}
                className={[
                  'flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all duration-200',
                  paginationPage < totalPages
                    ? 'border-zinc-200 bg-white text-zinc-700 hover:-translate-y-0.5 hover:bg-zinc-50 active:translate-y-0 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                    : 'cursor-not-allowed border-zinc-100 text-zinc-300 dark:border-white/5 dark:text-zinc-600',
                ].join(' ')}
              >
                Próxima
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !deleteMutation.isPending && setConfirmDeleteId(null)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Excluir plano PIX
            </h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Tem certeza que deseja excluir este plano? Esta ação não pode ser
              desfeita.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(confirmDeleteId)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={bulkConfirmOpen}
        title="Excluir planos PIX selecionados"
        description={`Tem certeza que deseja excluir ${bulk.count} plano(s) PIX? Esta ação não pode ser desfeita.`}
        loading={bulkDeleteMutation.isPending}
        onCancel={() => setBulkConfirmOpen(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(bulk.selected))}
      />
    </>
  );
}

export default function PlanosPixPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-48 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          Carregando planos…
        </div>
      }
    >
      <PlanosPixContent />
    </Suspense>
  );
}
