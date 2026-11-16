'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  FilterX,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { PlatformBadges } from '@/components/ui/PlatformBadges';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { endpoints } from '@/services/api/endpoints';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { fmtBRL, useClienteApi } from '../../cliente/_shared';
import { enumLabel, intervalLabels } from '../offers';
import {
  FREQUENCIES,
  OFFER_SUBSCRIBERS_QUERY_KEY,
  STATUS_GROUPS,
  SUBSCRIBERS_PAGE_SIZE,
  canPause,
  canResume,
  contractStatusLabels,
  emptySubscriberFilters,
  filtersToQuery,
  frequencyLabels,
  statusGroupLabels,
  type OfferSubscriber,
  type OfferSubscribersResponse,
  type SubscriberFilters,
} from './offer-subscribers';

const ALL = 'all';
const withAll = (
  label: string,
  options: { value: string; label: string }[],
) => [{ value: ALL, label }, ...options];

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

export default function OfferSubscribersPage() {
  const api = useClienteApi();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const platformCatalog = useProductPlatforms();
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [filters, setFilters] = useState<SubscriberFilters>(
    emptySubscriberFilters,
  );
  const change = (patch: Partial<SubscriberFilters>) =>
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  const [search, setSearch] = useDebouncedInput(filters.search, (value) =>
    change({ search: value }),
  );
  const apiQuery = filtersToQuery(filters);
  const query = useQuery({
    queryKey: [OFFER_SUBSCRIBERS_QUERY_KEY, user?.id, apiQuery],
    enabled: Boolean(
      user && (!user.isClient || user.clientStatus === 'APPROVED'),
    ),
    queryFn: () =>
      api.get<OfferSubscribersResponse>(endpoints.ofertas.subscribers, {
        query: apiQuery,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const mutate = useMutation({
    mutationFn: ({
      row,
      action,
    }: {
      row: OfferSubscriber;
      action: 'pause' | 'resume';
    }) =>
      api.put(
        action === 'pause'
          ? endpoints.ofertas.pauseSubscriber(row.id)
          : endpoints.ofertas.resumeSubscriber(row.id),
      ),
    onSuccess: (_response, { action }) => {
      toast({
        type: 'success',
        title:
          action === 'pause' ? 'Assinatura pausada' : 'Assinatura retomada',
      });
      void queryClient.invalidateQueries({
        queryKey: [OFFER_SUBSCRIBERS_QUERY_KEY],
      });
    },
    onError: (error) =>
      toast({
        type: 'error',
        title:
          error instanceof Error && error.message
            ? error.message
            : 'Não foi possível alterar a assinatura. Tente novamente.',
      }),
  });

  const columns: DataTableColumn<OfferSubscriber>[] = [
    {
      key: 'customer',
      header: 'Assinante',
      grow: true,
      className: 'text-left',
      headerClassName: 'text-left',
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {row.customerName || 'Não informado'}
          </span>
          <span className="truncate text-xs text-zinc-500">
            {row.customerEmail}
          </span>
        </span>
      ),
    },
    {
      key: 'offer',
      header: 'Oferta',
      defaultWidth: 220,
      className: 'text-left',
      headerClassName: 'text-left',
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.offer?.name ?? '—'}</span>
          <span className="text-xs text-zinc-500">{row.offer?.code}</span>
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Valor',
      defaultWidth: 120,
      render: (row) =>
        `${fmtBRL(row.amount)} / ${row.intervalCount} ${enumLabel(intervalLabels, row.intervalType)}`,
    },
    {
      key: 'platform',
      header: 'Plataforma',
      defaultWidth: 120,
      render: (row) => (
        <PlatformBadges
          platforms={
            row.offer?.platformTag ? [row.offer.platformTag.toUpperCase()] : []
          }
        />
      ),
    },
    {
      key: 'cycles',
      header: 'Ciclos pagos',
      defaultWidth: 110,
      render: (row) => row.paidCycles,
    },
    {
      key: 'createdAt',
      header: 'Início',
      defaultWidth: 110,
      render: (row) => date(row.createdAt),
    },
    {
      key: 'next',
      header: 'Próxima cobrança',
      defaultWidth: 150,
      render: (row) =>
        row.status === 'PAUSED'
          ? `${row.remainingDays ?? 0} dias guardados`
          : date(row.nextChargeAt),
    },
    {
      key: 'status',
      header: 'Status',
      defaultWidth: 110,
      render: (row) => enumLabel(contractStatusLabels, row.status),
    },
    {
      key: 'actions',
      header: 'Ações',
      defaultWidth: 96,
      render: (row) => (
        <div className="flex items-center justify-center gap-2">
          {canPause(row) && (
            <ConfirmActionButton
              variant="outline"
              size="icon-sm"
              disabled={mutate.isPending}
              className="cursor-pointer disabled:cursor-not-allowed"
              label="Pausar"
              confirmation="Pausar esta assinatura? Confirme em até 3 segundos."
              confirmContent={<Check aria-hidden className="h-4 w-4" />}
              onConfirm={() => mutate.mutate({ row, action: 'pause' })}
            >
              <Pause aria-hidden className="h-4 w-4" />
            </ConfirmActionButton>
          )}
          {canResume(row) && (
            <Button
              variant="outline"
              size="icon-sm"
              className="cursor-pointer disabled:cursor-not-allowed"
              disabled={mutate.isPending}
              aria-label="Retomar"
              title="Retomar"
              onClick={() => mutate.mutate({ row, action: 'resume' })}
            >
              <Play aria-hidden className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const hasFilters =
    Boolean(filters.search) ||
    Boolean(filters.statusGroup) ||
    Boolean(filters.frequency) ||
    Boolean(filters.platform);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Assinantes das ofertas</h1>
        <Link href="/ofertas">
          <ActionButton className="cursor-pointer">
            <ArrowLeft className="h-4 w-4" />
            Ofertas
          </ActionButton>
        </Link>
      </div>
      <div
        data-testid="offer-subscribers-filters"
        className="grid gap-4 rounded-2xl border border-white/40 bg-zinc-50/50 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5 sm:grid-cols-2 xl:grid-cols-5"
      >
        <Input
          label="Assinante ou oferta"
          name="subscriber-search"
          placeholder="Nome ou e-mail"
          theme={theme}
          value={search}
          onChange={setSearch}
        />
        <Dropdown
          label="Status"
          portal
          theme={theme}
          value={filters.statusGroup || ALL}
          options={withAll(
            'Todos',
            STATUS_GROUPS.map((group) => ({
              value: group,
              label: statusGroupLabels[group],
            })),
          )}
          onChange={(value) =>
            change({
              statusGroup:
                value === ALL
                  ? ''
                  : (value as SubscriberFilters['statusGroup']),
            })
          }
        />
        <Dropdown
          label="Frequência"
          portal
          theme={theme}
          value={filters.frequency || ALL}
          options={withAll(
            'Todas',
            FREQUENCIES.map((frequency) => ({
              value: frequency,
              label: frequencyLabels[frequency],
            })),
          )}
          onChange={(value) =>
            change({
              frequency:
                value === ALL ? '' : (value as SubscriberFilters['frequency']),
            })
          }
        />
        <Dropdown
          label="Plataforma"
          portal
          theme={theme}
          value={filters.platform || ALL}
          options={withAll(
            'Todas',
            platformCatalog.options.map(({ value, label }) => ({
              value,
              label,
            })),
          )}
          onChange={(value) => change({ platform: value === ALL ? '' : value })}
        />
        <ActionButton
          className="cursor-pointer self-end"
          disabled={!hasFilters}
          onClick={() => setFilters(emptySubscriberFilters)}
        >
          <FilterX className="h-4 w-4" />
          Limpar filtros
        </ActionButton>
      </div>
      {!query.isPending && query.isError ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 p-6 dark:border-red-500/30"
        >
          <p className="mb-4">Não foi possível carregar os assinantes.</p>
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
          rows={query.data?.data ?? []}
          loading={query.isPending}
          page={filters.page}
          pageSize={query.data?.pageSize ?? SUBSCRIBERS_PAGE_SIZE}
          total={query.data?.total ?? 0}
          onPageChange={(page) =>
            setFilters((current) => ({ ...current, page }))
          }
          minWidth="min-w-[1250px]"
          emptyTitle="Nenhum assinante encontrado"
        />
      )}
    </div>
  );
}
