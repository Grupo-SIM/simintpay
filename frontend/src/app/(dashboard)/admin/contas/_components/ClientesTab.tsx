'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Users } from 'lucide-react';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { Input } from '@/components/ui/Input';
import { useTheme } from 'next-themes';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';

type CommunityRow = {
  id: string;
  name: string;
  slug: string;
  source: string;
  isActive: boolean;
  bindings: number;
  accesses: number;
};

export default function ClientesTab() {
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

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 9;
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['comunidades', search, page],
    queryFn: () =>
      api.get<{
        data: (Omit<CommunityRow, 'bindings' | 'accesses'> & {
          _count?: { bindings?: number; accesses?: number };
        })[];
        total?: number;
        page?: number;
        pageSize?: number;
      }>(endpoints.admin.comunidades.list, {
        query: { page, pageSize, search: search.trim() || undefined },
      }),
    staleTime: 15_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(endpoints.admin.comunidades.delete(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comunidades'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'platform-taxas'] });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'plataformas', 'list'],
      });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['pix-plans'] });
      queryClient.invalidateQueries({ queryKey: ['links-pagamento'] });
      queryClient.invalidateQueries({ queryKey: ['links-assinatura'] });
      queryClient.invalidateQueries({ queryKey: ['comunidades-all'] });
      setConfirmDelete(null);
      toast({
        type: 'success',
        title: 'Cliente excluído',
        description: 'Cliente removido com sucesso.',
      });
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível excluir o cliente.';
      toast({
        type: 'error',
        title: 'Erro ao excluir cliente',
        description: message,
      });
    },
  });

  const rows: CommunityRow[] = (data?.data ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    slug: item.slug,
    source: item.source,
    isActive: item.isActive,
    bindings: item._count?.bindings ?? 0,
    accesses: item._count?.accesses ?? 0,
  }));

  const total = data?.total ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-end gap-4">
        <ActionButton
          variant="primary"
          className="h-9"
          onClick={() => router.push('/comunidades/criar')}
        >
          <Plus className="h-4 w-4" />
          Criar cliente
        </ActionButton>
      </div>

      <div className="rounded-2xl border border-white/40 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
        <div className="grid gap-3 md:grid-cols-1">
          <Input
            label="Buscar"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Nome ou slug"
            theme={fieldTheme}
            variant="navbar"
          />
        </div>
      </div>

      {isFetching && rows.length === 0 ? (
        <div className="rounded-2xl border border-white/40 bg-white/70 p-8 text-center text-zinc-500 dark:border-white/10 dark:bg-white/5">
          Carregando clientes...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/40 bg-white/70 p-8 text-center text-zinc-500 dark:border-white/10 dark:bg-white/5">
          Nenhum cliente encontrado.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => router.push(`/comunidades/${row.id}`)}
              className="group rounded-2xl border border-white/30 bg-white/70 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-violet-400/40 hover:shadow-md dark:border-white/10 dark:bg-white/5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {row.name}
                  </h3>
                  <p className="mt-1 text-xs font-mono text-zinc-500">
                    {row.slug}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                    {row.source === 'MANUAL' ? 'Manual' : 'Automática'}
                  </span>
                  {row.source !== 'PLATAFORMA' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete({ id: row.id, name: row.name });
                      }}
                      className="rounded-md p-1 text-zinc-400 transition hover:bg-red-500/10 hover:text-red-500"
                      aria-label={`Excluir cliente ${row.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 text-center">
                <div className="rounded-lg bg-zinc-100/70 px-2 py-2 dark:bg-white/5">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Status
                  </p>
                  <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                    {row.isActive ? 'Ativa' : 'Inativa'}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm font-medium text-violet-600 dark:text-violet-300">
                <Users className="mr-1.5 h-4 w-4" />
                Ver assinantes
              </div>
            </button>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-2 flex items-center justify-between rounded-xl border border-white/20 bg-white/60 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/5">
          <span className="text-zinc-500 dark:text-zinc-400">
            Página{' '}
            <strong className="text-zinc-800 dark:text-zinc-100">{page}</strong>{' '}
            de{' '}
            <strong className="text-zinc-800 dark:text-zinc-100">
              {totalPages}
            </strong>
          </span>
          <div className="flex gap-2">
            <ActionButton
              variant="outline"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Anterior
            </ActionButton>
            <ActionButton
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Próxima
            </ActionButton>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={Boolean(confirmDelete)}
        title="Excluir cliente"
        description={`Tem certeza que deseja excluir o cliente "${confirmDelete?.name ?? ''}"? Esta ação não pode ser desfeita.`}
        loading={deleteMutation.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() =>
          confirmDelete && deleteMutation.mutate(confirmDelete.id)
        }
      />
    </div>
  );
}
