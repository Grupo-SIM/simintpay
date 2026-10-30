'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';
import { useToast } from '@/components/ui/Toast';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { BoletosFilters } from './components/BoletosFilters';
import { BoletosTable } from './components/BoletosTable';
import type { BoletoFilters, BoletoRow } from './types';

function includesText(source: string, text: string) {
  return source.toLowerCase().includes(text.trim().toLowerCase());
}

interface ApiBoleto {
  id: string;
  codigo?: string;
  titulo?: string;
  descricao?: string | null;
  valor?: number;
  vencimentoDias?: number;
  ativo?: boolean;
  criadoEm?: string;
  cpfDono?: string | null;
  donoNome?: string | null;
  donoEmail?: string | null;
  plataformas?: string[];
  link?: string | null;
}

type ConfirmDialog = { rowId: string; titulo: string } | null;

function mapBoleto(raw: ApiBoleto): BoletoRow {
  return {
    id: raw.id,
    titulo: raw.titulo ?? '—',
    valor: raw.valor ?? 0,
    criadoPor: raw.donoNome ?? '—',
    criadoPorEmail: raw.donoEmail ?? null,
    status: raw.ativo !== false ? 'Ativo' : 'Inativo',
    link: raw.id
      ? `${process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL}/?simBoletoCode=${raw.id}`
      : null,
    cpfDono: raw.cpfDono ?? null,
    plataformas: raw.plataformas ?? [],
  };
}

export default function BoletosPage() {
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

  const [filters, setFilters] = useState<BoletoFilters>({
    titulo: searchParams.get('titulo') ?? '',
    platform: searchParams.get('platform') ?? 'all',
  });
  const [page, setPage] = useState(Number(searchParams.get('page') ?? '1'));
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>(null);
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
    () => ['boletos', filters.titulo, filters.platform, page],
    [filters, page],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(endpoints.boletos.delete(id)),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Boleto excluído',
        description: 'Boleto excluído com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['boletos'] });
      setConfirmDialog(null);
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível excluir o boleto.',
      });
    },
  });

  const updatePriceMutation = useMutation({
    mutationFn: ({ id, valor }: { id: string; valor: number }) =>
      api.put(endpoints.boletos.update(id), { valor }),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Preço atualizado',
        description: 'O valor do boleto foi atualizado.',
      });
      queryClient.invalidateQueries({ queryKey: ['boletos'] });
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível atualizar o preço do boleto.',
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(endpoints.boletos.update(id), { isActive }),
    onSuccess: (_res, vars) => {
      toast({
        type: 'success',
        title: vars.isActive ? 'Boleto ativado' : 'Boleto inativado',
        description: vars.isActive
          ? 'O boleto voltou a aceitar pagamentos.'
          : 'O boleto não aceita mais pagamentos.',
      });
      queryClient.invalidateQueries({ queryKey: ['boletos'] });
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível alterar o status do boleto.',
      });
    },
  });

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get<{
        data: ApiBoleto[];
        total: number;
        page: number;
        pageSize: number;
      }>(endpoints.boletos.list, { query: { page, pageSize } });
      const allRows = (res.data ?? []).map(mapBoleto).filter((row) => {
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
      router.push(`/boletos/criar?id=${rowId}`);
      return;
    }
    if (action === 'toggle') {
      const boleto = rows.find((row) => row.id === rowId);
      if (boleto)
        toggleActiveMutation.mutate({
          id: rowId,
          isActive: boleto.status !== 'Ativo',
        });
      return;
    }
    const boleto = rows.find((row) => row.id === rowId);
    setConfirmDialog({ rowId, titulo: boleto?.titulo ?? rowId });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Boletos</h1>
        <ActionButton
          variant="primary"
          className="h-9"
          onClick={() => router.push('/boletos/criar')}
        >
          <Plus className="h-4 w-4" />
          Adicionar novo boleto
        </ActionButton>
      </div>

      <BoletosFilters
        fieldTheme={fieldTheme}
        filters={filters}
        platformTags={platformTags}
        onChange={(next) => {
          setFilters((prev) => ({ ...prev, ...next }));
          setPage(1);
        }}
      />

      <BoletosTable
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
      />

      <ConfirmDeleteDialog
        open={Boolean(confirmDialog)}
        title="Excluir boleto"
        description={`Tem certeza que deseja excluir o boleto "${confirmDialog?.titulo ?? ''}"? Esta ação não pode ser desfeita.`}
        loading={deleteMutation.isPending}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() =>
          confirmDialog && deleteMutation.mutate(confirmDialog.rowId)
        }
      />
    </div>
  );
}
