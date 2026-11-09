'use client';

import { Check, Pencil, Plus, Power, RefreshCw } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { PlatformBadges } from '@/components/ui/PlatformBadges';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { useToast } from '@/components/ui/Toast';
import { CoproductionButton } from '@/components/coproduction';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { endpoints } from '@/services/api/endpoints';
import {
  checkoutUrlOferta,
  fmtBRL,
  LinkCell,
  useClienteApi,
} from '../../cliente/_shared';
import {
  OFFER_PAGE_SIZE,
  filtersToApiQuery,
  normalizeListResponse,
  type OfferFilters,
  type OfferListResponse,
} from '../offer-filters';
import {
  OFFERS_QUERY_KEY,
  enumLabel,
  offerLabel,
  methodLabels,
  offerStatus,
  recurrenceSummary,
  statusLabels,
  usesLabel,
  type Offer,
  type OfferStatus,
} from '../offers';
import { OfferFiltersBar } from './OfferFiltersBar';

const statusTones: Record<OfferStatus, string> = {
  ACTIVE:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400',
  INACTIVE:
    'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400',
  EXHAUSTED:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  EXPIRED:
    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300',
};

function Badge({ tone, children }: { tone: string; children: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${tone}`}
    >
      {children}
    </span>
  );
}

export function OfferListing({
  filters,
  onFiltersChange,
  onCreate,
  onEdit,
}: {
  filters: OfferFilters;
  onFiltersChange: (next: OfferFilters) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
}) {
  const api = useClienteApi();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const platformCatalog = useProductPlatforms();
  const apiQuery = filtersToApiQuery(
    user?.isAdmin ? filters : { ...filters, ownerSearch: '' },
  );
  const query = useQuery({
    queryKey: [OFFERS_QUERY_KEY, 'list', user?.id, apiQuery],
    enabled: Boolean(
      user && (!user.isClient || user.clientStatus === 'APPROVED'),
    ),
    queryFn: async () =>
      normalizeListResponse(
        await api.get<OfferListResponse | Offer[]>(endpoints.ofertas.list, {
          query: apiQuery,
        }),
        filters,
      ),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const toggle = useMutation({
    mutationFn: (offer: Offer) =>
      offer.isActive
        ? api.delete(endpoints.ofertas.deactivate(offer.id))
        : api.patch(endpoints.ofertas.update(offer.id), { isActive: true }),
    onSuccess: (_response, offer) => {
      toast({
        type: 'success',
        title: offer.isActive ? 'Oferta desativada' : 'Oferta ativada',
      });
      void queryClient.invalidateQueries({ queryKey: [OFFERS_QUERY_KEY] });
    },
    onError: () =>
      toast({
        type: 'error',
        title: 'Não foi possível alterar o status. Tente novamente.',
      }),
  });
  const rows = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';

  const columns: DataTableColumn<Offer>[] = [
    {
      key: 'name',
      header: 'Nome',
      grow: true,
      className: 'text-left',
      headerClassName: 'text-left',
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-zinc-500">{row.code}</span>
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Data de criação',
      defaultWidth: 170,
      render: (row) => (
        <time dateTime={row.createdAt} className="whitespace-nowrap">
          {new Date(row.createdAt).toLocaleString('pt-BR')}
        </time>
      ),
    },
    {
      key: 'kind',
      header: 'Tipo',
      defaultWidth: 150,
      render: (row) => (
        <Badge tone="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300">
          {offerLabel(row)}
        </Badge>
      ),
    },
    {
      key: 'amount',
      header: 'Preço',
      defaultWidth: 110,
      render: (row) => fmtBRL(row.amountCents / 100),
    },
    {
      key: 'recurrence',
      header: 'Recorrência',
      defaultWidth: 220,
      render: (row) => recurrenceSummary(row),
    },
    {
      key: 'methods',
      header: 'Meios',
      defaultWidth: 190,
      render: (row) =>
        row.acceptedMethods
          .map((method) => enumLabel(methodLabels, method))
          .join(', '),
    },
    {
      key: 'platforms',
      header: 'Plataforma',
      defaultWidth: 120,
      render: (row) => (
        <PlatformBadges
          platforms={row.platformTag ? [row.platformTag.toUpperCase()] : []}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      defaultWidth: 110,
      render: (row) => {
        const status = offerStatus(row);
        return (
          <Badge tone={statusTones[status]}>
            {enumLabel(statusLabels, status)}
          </Badge>
        );
      },
    },
    {
      key: 'uses',
      header: 'Usos',
      defaultWidth: 90,
      render: (row) => usesLabel(row),
    },
    {
      key: 'link',
      header: 'Link de checkout',
      defaultWidth: 210,
      className: 'text-left',
      headerClassName: 'text-left',
      render: (row) => <LinkCell url={checkoutUrlOferta(row.code)} />,
    },
    {
      key: 'actions',
      header: 'Ações',
      defaultWidth: 136,
      render: (row) => (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            className="cursor-pointer"
            aria-label="Editar"
            title="Editar"
            onClick={() => onEdit(row.id)}
          >
            <Pencil aria-hidden className="h-4 w-4" />
          </Button>
          <CoproductionButton product="ofertas" productId={row.id} iconOnly />
          {row.isActive ? (
            <ConfirmActionButton
              variant="outline"
              size="icon-sm"
              disabled={toggle.isPending}
              className="cursor-pointer disabled:cursor-not-allowed"
              label="Desativar"
              confirmation="Desativar esta oferta? Confirme em até 3 segundos."
              confirmContent={<Check aria-hidden className="h-4 w-4" />}
              onConfirm={() => toggle.mutate(row)}
            >
              <Power aria-hidden className="h-4 w-4" />
            </ConfirmActionButton>
          ) : (
            <Button
              variant="outline"
              size="icon-sm"
              className="cursor-pointer disabled:cursor-not-allowed"
              disabled={toggle.isPending}
              aria-label="Ativar"
              title="Ativar"
              onClick={() => toggle.mutate(row)}
            >
              <Power aria-hidden className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (user?.isAdmin)
    columns.splice(1, 0, {
      key: 'owner',
      header: 'Dono do link',
      defaultWidth: 240,
      className: 'text-left',
      headerClassName: 'text-left',
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {row.owner?.name || row.owner?.email || 'Não informado'}
          </span>
          <span className="truncate text-xs text-zinc-500">
            {row.owner?.email}
          </span>
        </span>
      ),
    });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Ofertas</h1>
        <ActionButton
          variant="primary"
          className="cursor-pointer"
          data-testid="offer-create"
          onClick={onCreate}
        >
          <Plus className="h-4 w-4" />
          Criar oferta
        </ActionButton>
      </div>
      <OfferFiltersBar
        filters={filters}
        isAdmin={Boolean(user?.isAdmin)}
        theme={theme}
        platforms={platformCatalog.options.map(({ value, label }) => ({
          value,
          label,
        }))}
        onChange={onFiltersChange}
      />
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
          rows={rows}
          loading={query.isPending}
          page={filters.page}
          pageSize={query.data?.meta.pageSize ?? OFFER_PAGE_SIZE}
          total={total}
          onPageChange={(page) => onFiltersChange({ ...filters, page })}
          minWidth={user?.isAdmin ? 'min-w-[2006px]' : 'min-w-[1766px]'}
          emptyTitle="Nenhuma oferta encontrada"
        />
      )}
    </div>
  );
}
