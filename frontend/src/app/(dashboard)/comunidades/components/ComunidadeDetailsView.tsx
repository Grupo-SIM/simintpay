'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { DataTable } from '@/components/ui/DataTable';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { DateRangePickerField } from '@/app/(dashboard)/relatorio/components/DateRangePickerField';
import type { DateRange } from '@/app/(dashboard)/relatorio/types';
import { useTheme } from 'next-themes';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useToast } from '@/components/ui/Toast';

type Props = {
  communityId: string;
  backHref: string;
};

function formatCpfInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function ComunidadeDetailsView({ communityId, backHref }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
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

  const [bindType, setBindType] = useState<
    'SUBSCRIPTION_LINK' | 'PAYMENT_LINK'
  >('SUBSCRIPTION_LINK');
  const [linkId, setLinkId] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ nome: '', cpf: '', email: '' });
  const [dateRange, setDateRange] = useState<DateRange>({
    start: null,
    end: null,
  });
  const pageSize = 20;

  const resumoQuery = useQuery({
    queryKey: ['comunidade-resumo', communityId],
    queryFn: () =>
      api.get<{
        data: {
          name: string;
          isActive: boolean;
          accessesActive: number;
          accessesExpired: number;
          minDaysRemaining: number;
        };
      }>(endpoints.admin.comunidades.resumo(communityId)),
    staleTime: 10_000,
  });

  const assinantesQuery = useQuery({
    queryKey: [
      'comunidade-assinantes',
      communityId,
      page,
      filters.nome,
      filters.cpf,
      filters.email,
      dateRange.start?.toISOString(),
      dateRange.end?.toISOString(),
    ],
    queryFn: () =>
      api.get<{
        data: {
          id: string;
          nome?: string;
          email?: string;
          cpf?: string;
          telefone?: string;
          status?: string;
          dataAssinatura?: string;
          dataRenovacao?: string;
          communityBinding?: { bindingType: string; bindingId: string };
        }[];
        total?: number;
        page?: number;
        pageSize?: number;
      }>(endpoints.admin.comunidades.assinantes(communityId), {
        query: {
          page,
          pageSize,
          nome: filters.nome.trim() || undefined,
          cpf: filters.cpf.trim() || undefined,
          email: filters.email.trim() || undefined,
          dataInicio: dateRange.start
            ? dateRange.start.toISOString().slice(0, 10)
            : undefined,
          dataFim: dateRange.end
            ? dateRange.end.toISOString().slice(0, 10)
            : undefined,
        },
      }),
    staleTime: 10_000,
  });

  const bindMutation = useMutation({
    mutationFn: () =>
      api.post(endpoints.admin.comunidades.bind(communityId), {
        type: bindType,
        linkId: linkId.trim(),
      }),
    onSuccess: () => {
      setLinkId('');
      queryClient.invalidateQueries({
        queryKey: ['comunidade-resumo', communityId],
      });
      toast({
        type: 'success',
        title: 'Vínculo criado',
        description: 'Link vinculado ao cliente com sucesso.',
      });
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível vincular este link.';
      toast({ type: 'error', title: 'Erro ao vincular', description: message });
    },
  });

  const summary = resumoQuery.data?.data;
  const rows = assinantesQuery.data?.data ?? [];
  const total = assinantesQuery.data?.total ?? rows.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="mb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className="flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Voltar para lista
        </button>
        <h1 className="text-xl font-semibold">
          Detalhes de{' '}
          <span className="text-violet-600 dark:text-violet-400">
            {summary?.name ?? 'Cliente'}
          </span>
        </h1>
      </div>

      <div className="grid gap-3 rounded-2xl border border-white/40 bg-white/70 p-4 md:grid-cols-4 dark:border-white/10 dark:bg-white/5">
        <div>
          <p className="text-xs text-zinc-500">Status</p>
          <p className="font-semibold">
            {summary?.isActive ? 'Ativa' : 'Inativa'}
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Acessos ativos</p>
          <p className="font-semibold">{summary?.accessesActive ?? 0}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Acessos expirados</p>
          <p className="font-semibold">{summary?.accessesExpired ?? 0}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Menor dias restantes</p>
          <p className="font-semibold">{summary?.minDaysRemaining ?? 0} dias</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/40 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
        <h2 className="mb-3 text-base font-semibold">Vínculo manual</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Dropdown
            label="Tipo"
            value={bindType}
            onChange={(value) =>
              setBindType(value as 'SUBSCRIPTION_LINK' | 'PAYMENT_LINK')
            }
            theme={fieldTheme}
            variant="navbar"
            options={[
              { value: 'SUBSCRIPTION_LINK', label: 'Link de assinatura' },
              { value: 'PAYMENT_LINK', label: 'Link de pagamento' },
            ]}
          />
          <Input
            label="ID/Código do link"
            value={linkId}
            onChange={setLinkId}
            theme={fieldTheme}
            variant="navbar"
            placeholder="Cole ID interno, código ou domPlanId"
          />
          <div className="flex items-end">
            <ActionButton
              variant="primary"
              className="h-10 w-full"
              onClick={() => bindMutation.mutate()}
            >
              Vincular
            </ActionButton>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/40 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
        <h2 className="mb-3 text-base font-semibold">Filtros</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <Input
            label="Nome"
            value={filters.nome}
            onChange={(v) => {
              setFilters((prev) => ({ ...prev, nome: v }));
              setPage(1);
            }}
            theme={fieldTheme}
            variant="navbar"
            placeholder="Nome do assinante"
          />
          <Input
            label="CPF"
            value={filters.cpf}
            onChange={(v) => {
              setFilters((prev) => ({ ...prev, cpf: formatCpfInput(v) }));
              setPage(1);
            }}
            theme={fieldTheme}
            variant="navbar"
            placeholder="000.000.000-00"
          />
          <Input
            label="Email"
            value={filters.email}
            onChange={(v) => {
              setFilters((prev) => ({ ...prev, email: v }));
              setPage(1);
            }}
            theme={fieldTheme}
            variant="navbar"
            placeholder="assinante@email.com"
          />
          <DateRangePickerField
            label="Período (assinatura)"
            value={dateRange}
            onChange={(next) => {
              setDateRange(next);
              setPage(1);
            }}
            theme={fieldTheme}
          />
        </div>
      </div>

      <DataTable
        rows={rows}
        loading={assinantesQuery.isFetching}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        minWidth="min-w-[1200px]"
        emptyTitle="Sem assinantes"
        emptyDescription="Nenhum assinante registrado para este cliente."
        columns={[
          { key: 'nome', header: 'Nome', render: (row) => row.nome ?? '—' },
          { key: 'email', header: 'Email', render: (row) => row.email ?? '—' },
          { key: 'cpf', header: 'CPF', render: (row) => row.cpf ?? '—' },
          {
            key: 'telefone',
            header: 'Telefone',
            render: (row) => row.telefone ?? '—',
          },
          {
            key: 'dataAssinatura',
            header: 'Data assinatura',
            render: (row) =>
              row.dataAssinatura
                ? new Date(row.dataAssinatura).toLocaleDateString('pt-BR')
                : '—',
          },
          {
            key: 'dataRenovacao',
            header: 'Data renovação',
            render: (row) =>
              row.dataRenovacao
                ? new Date(row.dataRenovacao).toLocaleDateString('pt-BR')
                : '—',
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => row.status ?? '—',
          },
        ]}
      />
    </div>
  );
}
