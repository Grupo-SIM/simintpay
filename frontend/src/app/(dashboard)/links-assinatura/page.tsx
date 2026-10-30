'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { BulkActionsBar } from '@/components/ui/BulkActionsBar';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';
import { useToast } from '@/components/ui/Toast';
import { useBulkSelect } from '@/hooks/use-bulk-select';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { LinksAssinaturaFilters } from './components/LinksAssinaturaFilters';
import { LinksAssinaturaTable } from './components/LinksAssinaturaTable';
import {
  type LinkAssinaturaFilters,
  type LinkAssinaturaRow,
  normalizeSubscriptionFrequency,
} from './types';

function includesText(source: string, text: string) {
  return source.toLowerCase().includes(text.trim().toLowerCase());
}

interface ApiLink {
  id: string;
  codigo?: string;
  nome?: string;
  valor?: number;
  frequencia?: string;
  usos?: number;
  maxUsos?: number | null;
  code?: string;
  ownerEmail?: string;
  frequencyType?: string;
  isStandalone?: boolean;
  platformFee?: number;
  maxUses?: number | null;
  currentUses?: number;
  plataformas?: string[];
  ativo?: boolean;
  isActive?: boolean;
  donoNome?: string | null;
  donoEmail?: string | null;
}

type ConfirmDialog = { rowId: string; code: string } | null;

function mapLink(raw: ApiLink): LinkAssinaturaRow {
  const code = raw.codigo ?? raw.code ?? '';
  const maxUses = raw.maxUsos ?? raw.maxUses ?? null;
  const currentUses = raw.usos ?? raw.currentUses ?? 0;
  const frequencyType = normalizeSubscriptionFrequency(
    raw.frequencia ?? raw.frequencyType,
  );
  const ownerEmail = raw.ownerEmail ?? raw.nome ?? '—';
  const limitReached = maxUses !== null && currentUses >= maxUses;
  const isActive = raw.ativo ?? raw.isActive ?? true;
  return {
    id: raw.id,
    code: code || '—',
    titulo: raw.nome ?? '—',
    valor: raw.valor ?? 0,
    ownerEmail,
    criadoPor: raw.donoNome ?? '—',
    criadoPorEmail: raw.donoEmail ?? null,
    frequencyType,
    isStandalone: raw.isStandalone ?? true,
    platformFee: raw.platformFee ?? 9,
    maxUses,
    currentUses,
    status: !isActive ? 'Inativo' : limitReached ? 'Limite atingido' : 'Ativo',
    isActive,
    checkoutLink: code
      ? `${process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL}/?subscriptionLinkCode=${encodeURIComponent(code)}`
      : '—',
    plataformas: raw.plataformas ?? [],
  };
}

export default function LinksAssinaturaPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

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

  const [filters, setFilters] = useState<LinkAssinaturaFilters>({
    code: searchParams.get('code') ?? '',
    frequencyType:
      (searchParams.get(
        'frequencyType',
      ) as LinkAssinaturaFilters['frequencyType']) ?? 'all',
    platform: searchParams.get('platform') ?? 'all',
  });
  const [page, setPage] = useState(Number(searchParams.get('page') ?? '1'));
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>(null);
  const bulk = useBulkSelect();
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const pageSize = 10;

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.code.trim()) params.set('code', filters.code.trim());
    if (filters.frequencyType !== 'all')
      params.set('frequencyType', filters.frequencyType);
    if (filters.platform !== 'all') params.set('platform', filters.platform);
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [filters, page, router, pathname]);

  const queryKey = useMemo(
    () => [
      'links-assinatura',
      filters.code,
      filters.frequencyType,
      filters.platform,
      page,
    ],
    [filters, page],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(endpoints.linksAssinatura.delete(id)),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Link excluído',
        description: 'Link de assinatura excluído com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['links-assinatura'] });
      setConfirmDialog(null);
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível excluir o link de assinatura.',
      });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => api.delete(endpoints.linksAssinatura.delete(id))),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      return { ok, fail: results.length - ok };
    },
    onSuccess: ({ ok, fail }) => {
      queryClient.invalidateQueries({ queryKey: ['links-assinatura'] });
      bulk.clear();
      setBulkConfirmOpen(false);
      if (fail === 0)
        toast({
          type: 'success',
          title: 'Links excluídos',
          description: `${ok} link(s) excluído(s).`,
        });
      else if (ok === 0)
        toast({
          type: 'error',
          title: 'Erro',
          description: `Não foi possível excluir os ${fail} link(s) selecionado(s).`,
        });
      else
        toast({
          type: 'success',
          title: 'Parcialmente excluído',
          description: `${ok} excluído(s), ${fail} falhou(aram).`,
        });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['links-assinatura'] });
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível excluir os links selecionados.',
      });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(endpoints.linksAssinatura.update(id), { isActive }),
    onSuccess: (_data, variables) => {
      toast({
        type: 'success',
        title: variables.isActive ? 'Link ativado' : 'Link inativado',
        description: variables.isActive
          ? 'O link de assinatura voltou a aceitar novas assinaturas.'
          : 'O link de assinatura não aceita mais novas assinaturas e o checkout foi bloqueado.',
      });
      queryClient.invalidateQueries({ queryKey: ['links-assinatura'] });
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível alterar o status do link.',
      });
    },
  });

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get<{
        data?: ApiLink[];
        total?: number;
        page?: number;
      }>(endpoints.linksAssinatura.list, { query: { page, pageSize } });
      const allRows = (res.data ?? []).map(mapLink).filter((row) => {
        const codeMatch =
          !filters.code.trim() || includesText(row.code, filters.code);
        const frequencyMatch =
          filters.frequencyType === 'all' ||
          row.frequencyType === filters.frequencyType;
        const platformMatch =
          filters.platform === 'all' ||
          row.plataformas.some(
            (p) => p.toUpperCase() === filters.platform.toUpperCase(),
          );
        return codeMatch && frequencyMatch && platformMatch;
      });
      return {
        rows: allRows,
        total: res.total ?? allRows.length,
        safePage: res.page ?? page,
      };
    },
    staleTime: 30 * 1000,
  });

  const rows = data?.rows ?? [];

  function handleRowAction(
    action: 'editar' | 'assinantes' | 'alternar-status' | 'excluir',
    rowId: string,
  ) {
    const row = rows.find((item) => item.id === rowId);
    if (!row) return;
    if (action === 'editar') {
      const currentQuery = searchParams.toString();
      const returnTo = currentQuery ? `${pathname}?${currentQuery}` : pathname;
      const params = new URLSearchParams({ id: row.id, returnTo });
      router.push(`/links-assinatura/criar?${params.toString()}`);
      return;
    }
    if (action === 'assinantes') {
      router.push(`/links-assinatura/${rowId}/assinantes`);
      return;
    }
    if (action === 'alternar-status') {
      toggleStatusMutation.mutate({ id: rowId, isActive: !row.isActive });
      return;
    }
    setConfirmDialog({ rowId, code: row.code });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Links de assinatura</h1>
        <ActionButton
          variant="primary"
          className="h-9"
          onClick={() => router.push('/links-assinatura/criar')}
        >
          <Plus className="h-4 w-4" />
          Adicionar novo link
        </ActionButton>
      </div>

      <LinksAssinaturaFilters
        fieldTheme={fieldTheme}
        filters={filters}
        platformTags={platformTags}
        onChange={(next) => {
          setFilters((prev) => ({ ...prev, ...next }));
          setPage(1);
        }}
      />

      <BulkActionsBar
        count={bulk.count}
        deleting={bulkDeleteMutation.isPending}
        onClear={bulk.clear}
        onDelete={() => setBulkConfirmOpen(true)}
      />

      <LinksAssinaturaTable
        rows={rows}
        page={data?.safePage ?? 1}
        pageSize={pageSize}
        total={data?.total ?? 0}
        fieldTheme={fieldTheme}
        onPageChange={setPage}
        onRowAction={handleRowAction}
        selectedIds={bulk.selected}
        onToggleRow={bulk.toggle}
        onToggleAll={() => bulk.toggleAll(rows.map((r) => r.id))}
      />

      <ConfirmDeleteDialog
        open={Boolean(confirmDialog)}
        title="Excluir link de assinatura"
        description={`Tem certeza que deseja excluir o link "${confirmDialog?.code ?? ''}"? Esta ação não pode ser desfeita.`}
        loading={deleteMutation.isPending}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() =>
          confirmDialog && deleteMutation.mutate(confirmDialog.rowId)
        }
      />

      <ConfirmDeleteDialog
        open={bulkConfirmOpen}
        title="Excluir links selecionados"
        description={`Tem certeza que deseja excluir ${bulk.count} link(s) de assinatura? Esta ação não pode ser desfeita.`}
        loading={bulkDeleteMutation.isPending}
        onCancel={() => setBulkConfirmOpen(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(bulk.selected))}
      />
    </div>
  );
}
