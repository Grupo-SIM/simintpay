'use client';

import { useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProductStatusBadge } from '@/components/ui/ProductStatusBadge';
import { PlatformBadges } from '@/components/ui/PlatformBadges';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { useCurrentUser } from '@/hooks/use-current-user';
import { fmtBRL, LinkCell, useClienteApi } from '../_shared';
import {
  filterProducts,
  mapProduct,
  productConfigs,
  type ProductKind,
  type ProductListResponse,
  type ProductRow,
  type RawProduct,
} from '../product-list';
import { ProductFilters, emptyProductFilters } from './ProductFilters';
import { CoproductionBadge } from '@/components/coproduction/CoproductionBadge';
import { ProductRowActions } from './ProductRowActions';

export function ProductListing({ kind }: { kind: ProductKind }) {
  const api = useClienteApi();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const config = productConfigs[kind];
  const [filters, setFilters] = useState(emptyProductFilters);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const queryKey = [config.queryKey, user?.id];
  const query = useQuery({
    queryKey,
    enabled: Boolean(user?.isClient && user.clientStatus === 'APPROVED'),
    queryFn: async () => {
      const items: RawProduct[] = [];
      let requestPage = 1;
      for (;;) {
        const response = await api.get<ProductListResponse>(
          config.endpoint.list,
          {
            query: {
              page: requestPage,
              pageSize: 100,
              ...(kind !== 'links-pagamento' ? { limit: 100 } : {}),
            },
          },
        );
        const batch = response.data ?? response.items;
        if (!Array.isArray(batch))
          throw new Error('Resposta de listagem inválida');
        items.push(...batch);
        const total = response.total ?? response.meta?.totalItems;
        const totalPages = response.meta?.totalPages;
        if (
          kind === 'planos' ||
          batch.length === 0 ||
          (total != null
            ? items.length >= total
            : totalPages != null
              ? requestPage >= totalPages
              : batch.length < 100)
        )
          break;
        requestPage += 1;
      }
      return items.map((raw) => mapProduct(kind, raw));
    },
    staleTime: 30_000,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(config.endpoint.delete(id)),
    onSuccess: () => {
      toast({ type: 'success', title: 'Registro excluído' });
      void queryClient.invalidateQueries({ queryKey: [config.queryKey] });
    },
    onError: () =>
      toast({
        type: 'error',
        title: 'Não foi possível excluir. Tente novamente.',
      }),
  });
  const statusMutation = useMutation({
    mutationFn: async (row: ProductRow) => {
      if (kind === 'planos') {
        return row.active
          ? api.post(productConfigs.planos.endpoint.deactivate(row.id), {})
          : api.post(config.endpoint.update(row.id), { isActive: true });
      }
      if (kind === 'planos-pix')
        return api.patch(
          productConfigs['planos-pix'].endpoint.toggleStatus(row.id),
        );
      return api.put(config.endpoint.update(row.id), { isActive: !row.active });
    },
    onSuccess: (_response, row) => {
      toast({
        type: 'success',
        title: row.active ? 'Registro inativado' : 'Registro ativado',
      });
      void queryClient.invalidateQueries({ queryKey: [config.queryKey] });
    },
    onError: () =>
      toast({
        type: 'error',
        title: 'Não foi possível alterar o status. Tente novamente.',
      }),
  });
  const filtered = useMemo(
    () => filterProducts(query.data ?? [], filters),
    [query.data, filters],
  );
  const safePage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / pageSize)),
  );
  const columns: DataTableColumn<ProductRow>[] = [
    {
      key: 'name',
      header: kind === 'planos' || kind === 'planos-pix' ? 'Nome' : 'Título',
      grow: true,
      className: 'text-left',
      headerClassName: 'text-left',
      render: (row) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {row.name}
          <CoproductionBadge info={row.coproduction} />
        </span>
      ),
    },
    {
      key: 'link',
      header: 'Link',
      defaultWidth: 180,
      className: 'text-left',
      headerClassName: 'text-left',
      render: (row) => <LinkCell url={row.url} />,
    },
    {
      key: 'platforms',
      header: 'Plataformas',
      defaultWidth: 130,
      render: (row) => <PlatformBadges platforms={row.platforms} />,
    },
    ...(config.intervalLabel
      ? [
          {
            key: 'interval',
            header: config.intervalLabel,
            defaultWidth: 110,
            render: (row: ProductRow) => row.interval ?? '—',
          },
        ]
      : []),
    {
      key: 'amount',
      header: 'Preço',
      defaultWidth: 120,
      render: (row) => fmtBRL(row.amount),
    },
    ...(kind !== 'boletos'
      ? [
          {
            key: 'net',
            header: 'Valor líquido',
            defaultWidth: 130,
            render: (row: ProductRow) => (
              <span className="text-emerald-700 dark:text-emerald-400">
                {row.netAmount == null ? '—' : fmtBRL(row.netAmount)}
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'status',
      header: 'Status',
      defaultWidth: 100,
      render: (row) => <ProductStatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: 'Ações',
      defaultWidth: 260,
      render: (row) => (
        <ProductRowActions
          kind={kind}
          id={row.id}
          deleting={deleteMutation.isPending}
          active={row.active}
          changingStatus={statusMutation.isPending}
          readOnly={row.coproduction?.readOnly}
          onToggle={() => statusMutation.mutate(row)}
          onDelete={() => deleteMutation.mutate(row.id)}
        />
      ),
    },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">{config.title}</h1>
        <ActionButton
          variant="primary"
          className="cursor-pointer"
          onClick={() => router.push(`/cliente/${kind}/criar`)}
        >
          <Plus className="h-4 w-4" />
          {config.createLabel}
        </ActionButton>
      </div>
      <ProductFilters
        platforms={[
          ...new Set((query.data ?? []).flatMap((row) => row.platforms)),
        ].sort()}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      {!query.isPending && query.isError ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 p-6 dark:border-red-500/30"
        >
          <p className="mb-4">Não foi possível carregar os registros.</p>
          <ActionButton
            className="cursor-pointer"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </ActionButton>
        </div>
      ) : (
        <DataTable
          getRowId={(row) => row.id}
          columns={columns}
          rows={filtered.slice((safePage - 1) * pageSize, safePage * pageSize)}
          loading={query.isPending}
          page={safePage}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          minWidth="min-w-[1140px]"
          emptyTitle="Nenhum registro encontrado"
        />
      )}
    </div>
  );
}
