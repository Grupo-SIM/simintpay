'use client';

import { useMemo, useState } from 'react';
import { Pencil, Plus, Power, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProductStatusBadge } from '@/components/ui/ProductStatusBadge';
import { PlatformBadges } from '@/components/ui/PlatformBadges';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { useToast } from '@/components/ui/Toast';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { useCurrentUser } from '@/hooks/use-current-user';
import { endpoints } from '@/services/api/endpoints';
import { checkoutUrlOferta, fmtBRL, LinkCell, useClienteApi } from '../_shared';
import {
  OFFERS_QUERY_KEY,
  enumLabel,
  kindLabels,
  offerStatus,
  recurrenceSummary,
  type Offer,
} from './offers';

export default function OfertasPage() {
  const api = useClienteApi();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const query = useQuery({
    queryKey: [OFFERS_QUERY_KEY, user?.id],
    enabled: Boolean(user?.isClient && user.clientStatus === 'APPROVED'),
    queryFn: () => api.get<Offer[]>(endpoints.ofertas.list),
    staleTime: 30_000,
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(endpoints.ofertas.deactivate(id)),
    onSuccess: () => {
      toast({ type: 'success', title: 'Oferta desativada' });
      void queryClient.invalidateQueries({ queryKey: [OFFERS_QUERY_KEY] });
    },
    onError: () =>
      toast({
        type: 'error',
        title: 'Não foi possível desativar. Tente novamente.',
      }),
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const safePage = Math.min(
    page,
    Math.max(1, Math.ceil(rows.length / pageSize)),
  );

  const columns: DataTableColumn<Offer>[] = [
    {
      key: 'name',
      header: 'Nome',
      grow: true,
      className: 'text-left',
      headerClassName: 'text-left',
      render: (row) => row.name,
    },
    {
      key: 'kind',
      header: 'Tipo',
      defaultWidth: 150,
      render: (row) => enumLabel(kindLabels, row.kind),
    },
    {
      key: 'link',
      header: 'Link',
      defaultWidth: 180,
      className: 'text-left',
      headerClassName: 'text-left',
      render: (row) => <LinkCell url={checkoutUrlOferta(row.code)} />,
    },
    {
      key: 'platforms',
      header: 'Plataformas',
      defaultWidth: 130,
      render: (row) => (
        <PlatformBadges
          platforms={row.platformTag ? [row.platformTag.toUpperCase()] : []}
        />
      ),
    },
    {
      key: 'recurrence',
      header: 'Recorrência',
      defaultWidth: 240,
      render: (row) => recurrenceSummary(row),
    },
    {
      key: 'amount',
      header: 'Preço',
      defaultWidth: 120,
      render: (row) => fmtBRL(row.amountCents / 100),
    },
    {
      key: 'status',
      header: 'Status',
      defaultWidth: 120,
      render: (row) => <ProductStatusBadge status={offerStatus(row)} />,
    },
    {
      key: 'actions',
      header: 'Ações',
      defaultWidth: 220,
      render: (row) => (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() =>
              router.push(
                `/cliente/ofertas/criar?id=${encodeURIComponent(row.id)}`,
              )
            }
          >
            <Pencil aria-hidden className="h-4 w-4" /> Editar
          </Button>
          {row.isActive && (
            <ConfirmActionButton
              variant="outline"
              size="sm"
              disabled={deactivate.isPending}
              className="cursor-pointer disabled:cursor-not-allowed"
              label="Desativar"
              confirmation="Desativar esta oferta? Confirme em até 3 segundos."
              confirmContent="Confirmar"
              onConfirm={() => deactivate.mutate(row.id)}
            >
              <Power aria-hidden className="h-4 w-4" /> Desativar
            </ConfirmActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Ofertas</h1>
        <ActionButton
          variant="primary"
          className="cursor-pointer"
          onClick={() => router.push('/cliente/ofertas/criar')}
        >
          <Plus className="h-4 w-4" />
          Criar oferta
        </ActionButton>
      </div>
      {!query.isPending && query.isError ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 p-6 dark:border-red-500/30"
        >
          <p className="mb-4">Não foi possível carregar as ofertas.</p>
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
          rows={rows.slice((safePage - 1) * pageSize, safePage * pageSize)}
          loading={query.isPending}
          page={safePage}
          pageSize={pageSize}
          total={rows.length}
          onPageChange={setPage}
          minWidth="min-w-[1180px]"
          emptyTitle="Nenhuma oferta encontrada"
        />
      )}
    </div>
  );
}
