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
import { LinksPagamentoFilters } from './components/LinksPagamentoFilters';
import { LinksPagamentoTable } from './components/LinksPagamentoTable';
import type { LinkPagamentoFilters, LinkPagamentoRow } from './types';

function includesText(source: string, text: string) {
  return source.toLowerCase().includes(text.trim().toLowerCase());
}

interface ApiLink {
  id: string;
  codigo?: string;
  titulo?: string;
  descricao?: string | null;
  valor?: number;
  parcelasMax?: number;
  ativo?: boolean;
  criadoEm?: string;
  cpfDono?: string | null;
  donoNome?: string | null;
  donoEmail?: string | null;
  plataformas?: string[];
}

type ConfirmDialog = { rowId: string; titulo: string } | null;

function mapLink(raw: ApiLink): LinkPagamentoRow {
  return {
    id: raw.id,
    titulo: raw.titulo ?? '—',
    produto: raw.descricao ?? '—',
    valor: raw.valor ?? 0,
    criadoPor: raw.donoNome ?? '—',
    criadoPorEmail: raw.donoEmail ?? null,
    metodoPagamento: 'all',
    status: raw.ativo !== false ? 'Ativo' : 'Inativo',
    link: raw.id
      ? `${process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL}/?simLinkCode=${raw.id}`
      : '—',
    cpfDono: raw.cpfDono ?? null,
    plataformas: raw.plataformas ?? [],
  };
}

export default function LinksPagamentoPage() {
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
      .filter((t) => !['FRENDZ'].includes(t.toUpperCase()))
      .sort();
  }, [taxasRes]);

  const [filters, setFilters] = useState<LinkPagamentoFilters>({
    titulo: searchParams.get('titulo') ?? '',
    platform: searchParams.get('platform') ?? 'all',
  });
  const [page, setPage] = useState(Number(searchParams.get('page') ?? '1'));
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>(null);
  const bulk = useBulkSelect();
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const pageSize = 10;

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.titulo.trim()) params.set('titulo', filters.titulo.trim());
    if (filters.platform !== 'all') params.set('platform', filters.platform);
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [filters, page, router, pathname]);

  const queryKey = useMemo(
    () => ['links-pagamento', filters.titulo, filters.platform, page],
    [filters, page],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(endpoints.linksPagamento.delete(id)),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Link excluído',
        description: 'Link de pagamento excluído com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['links-pagamento'] });
      setConfirmDialog(null);
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível excluir o link de pagamento.',
      });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => api.delete(endpoints.linksPagamento.delete(id))),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      return { ok, fail: results.length - ok };
    },
    onSuccess: ({ ok, fail }) => {
      queryClient.invalidateQueries({ queryKey: ['links-pagamento'] });
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
      queryClient.invalidateQueries({ queryKey: ['links-pagamento'] });
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível excluir os links selecionados.',
      });
    },
  });

  const updatePriceMutation = useMutation({
    mutationFn: ({ id, valor }: { id: string; valor: number }) =>
      api.put(endpoints.linksPagamento.update(id), { valor }),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Preço atualizado',
        description: 'O valor do link foi atualizado.',
      });
      queryClient.invalidateQueries({ queryKey: ['links-pagamento'] });
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível atualizar o preço do link.',
      });
    },
  });

  // Ativar/inativar link — usa o mesmo update (backend já dá poder absoluto ao master).
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(endpoints.linksPagamento.update(id), { isActive }),
    onSuccess: (_res, vars) => {
      toast({
        type: 'success',
        title: vars.isActive ? 'Link ativado' : 'Link inativado',
        description: vars.isActive
          ? 'O link voltou a aceitar pagamentos.'
          : 'O link não aceita mais pagamentos.',
      });
      queryClient.invalidateQueries({ queryKey: ['links-pagamento'] });
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
        data: ApiLink[];
        total: number;
        page: number;
        pageSize: number;
      }>(endpoints.linksPagamento.list, { query: { page, pageSize } });
      const allRows = (res.data ?? []).map(mapLink).filter((row) => {
        const tituloMatch =
          !filters.titulo.trim() || includesText(row.titulo, filters.titulo);
        const platformMatch =
          filters.platform === 'all' ||
          row.plataformas.some(
            (p) => p.toUpperCase() === filters.platform.toUpperCase(),
          );
        return tituloMatch && platformMatch;
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
    action: 'editar' | 'excluir' | 'toggle',
    rowId: string,
  ) {
    if (action === 'editar') {
      router.push(`/links-pagamento/criar?id=${rowId}`);
      return;
    }
    if (action === 'toggle') {
      const link = rows.find((row) => row.id === rowId);
      if (link)
        toggleActiveMutation.mutate({
          id: rowId,
          isActive: link.status !== 'Ativo',
        });
      return;
    }
    const link = rows.find((row) => row.id === rowId);
    setConfirmDialog({ rowId, titulo: link?.titulo ?? rowId });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Links de pagamentos</h1>
        <ActionButton
          variant="primary"
          className="h-9"
          onClick={() => router.push('/links-pagamento/criar')}
        >
          <Plus className="h-4 w-4" />
          Adicionar novo link
        </ActionButton>
      </div>

      <LinksPagamentoFilters
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

      <LinksPagamentoTable
        rows={rows}
        page={data?.safePage ?? 1}
        pageSize={pageSize}
        total={data?.total ?? 0}
        fieldTheme={fieldTheme}
        onPageChange={setPage}
        onRowAction={handleRowAction}
        onPriceChange={(id, valor) => updatePriceMutation.mutate({ id, valor })}
        savingPriceId={
          updatePriceMutation.isPending
            ? (updatePriceMutation.variables?.id ?? null)
            : null
        }
        selectedIds={bulk.selected}
        onToggleRow={bulk.toggle}
        onToggleAll={() => bulk.toggleAll(rows.map((r) => r.id))}
      />

      <ConfirmDeleteDialog
        open={Boolean(confirmDialog)}
        title="Excluir link de pagamento"
        description={`Tem certeza que deseja excluir o link "${confirmDialog?.titulo ?? ''}"? Esta ação não pode ser desfeita.`}
        loading={deleteMutation.isPending}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() =>
          confirmDialog && deleteMutation.mutate(confirmDialog.rowId)
        }
      />

      <ConfirmDeleteDialog
        open={bulkConfirmOpen}
        title="Excluir links selecionados"
        description={`Tem certeza que deseja excluir ${bulk.count} link(s) de pagamento? Esta ação não pode ser desfeita.`}
        loading={bulkDeleteMutation.isPending}
        onCancel={() => setBulkConfirmOpen(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(bulk.selected))}
      />
    </div>
  );
}
