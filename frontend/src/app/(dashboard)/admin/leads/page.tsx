'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Trash2, X, XCircle } from 'lucide-react';

import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Dropdown } from '@/components/ui/Dropdown';
import { Spinner } from '@/components/ui/Loading';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useAdminLeads } from '@/features/admin/hooks/use-admin-leads';
import type { Lead, LeadStatus } from '@/features/admin/types/admin.types';

function formatDate(value: string | undefined | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFaturamento(value: string | undefined | null) {
  if (!value) return '-';
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .replace(/Ate/g, 'Até')
    .replace(/(\d+)k/g, 'R$ $1.000,00');
}

const STATUS_LABELS: Record<LeadStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
};

const STATUS_VARIANTS: Record<
  LeadStatus,
  'default' | 'success' | 'destructive'
> = {
  PENDING: 'default',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

const statusOptions = [
  { value: '', label: 'Todos' },
  { value: 'PENDING', label: 'Pendentes' },
  { value: 'APPROVED', label: 'Aprovados' },
  { value: 'REJECTED', label: 'Rejeitados' },
];

export default function AdminLeadsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: loadingUser } = useCurrentUser();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, loading, approveLead, rejectLead, deleteLeads } = useAdminLeads(
    {
      page,
      pageSize: 20,
      status: (statusFilter as LeadStatus) || undefined,
    },
  );

  if (!loadingUser && !user?.isAdmin) {
    router.replace('/painel');
    return null;
  }

  async function handleApprove(lead: Lead) {
    setActionLoading(lead.id);
    try {
      await approveLead(lead.id);
      toast({
        type: 'success',
        title: 'Lead aprovado',
        description: `Conta criada para ${lead.name}.`,
      });
    } catch {
      toast({
        type: 'error',
        title: 'Erro ao aprovar',
        description: 'Tente novamente.',
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(lead: Lead) {
    setActionLoading(lead.id);
    try {
      await rejectLead(lead.id);
      toast({ type: 'success', title: 'Lead rejeitado' });
    } catch {
      toast({
        type: 'error',
        title: 'Erro ao rejeitar',
        description: 'Tente novamente.',
      });
    } finally {
      setActionLoading(null);
    }
  }

  const selectedLeads = data.data.filter((lead) => selectedIds.has(lead.id));
  const deletableLeads = selectedLeads.filter(
    (lead) => lead.status !== 'PENDING',
  );

  function toggleLead(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllLeads() {
    const allSelected =
      data.data.length > 0 &&
      data.data.every((lead) => selectedIds.has(lead.id));
    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const lead of data.data) {
        if (allSelected) next.delete(lead.id);
        else next.add(lead.id);
      }
      return next;
    });
  }

  async function handleDeleteSelected() {
    setActionLoading('bulk-delete');
    try {
      await deleteLeads(deletableLeads.map((lead) => lead.id));
      setConfirmDelete(false);
      setSelectedIds(new Set());
      toast({
        type: 'success',
        title: 'Solicitações excluídas',
        description: `${deletableLeads.length} solicitação(ões) removida(s).`,
      });
    } catch {
      toast({
        type: 'error',
        title: 'Erro ao excluir',
        description: 'Não foi possível excluir as solicitações selecionadas.',
      });
    } finally {
      setActionLoading(null);
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Nome',
      render: (row: Lead) => (
        <div className="flex flex-col items-center">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 text-center">
            {row.name}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
            {row.email}
          </p>
        </div>
      ),
    },
    {
      key: 'empresa',
      header: 'Empresa',
      render: (row: Lead) => (
        <div className="flex flex-col items-center">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 text-center">
            {row.razaoSocial}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
            {row.cnpj}
          </p>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Contato',
      render: (row: Lead) => (
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {row.phone}
        </span>
      ),
    },
    {
      key: 'cargo',
      header: 'Cargo',
      render: (row: Lead) => (
        <span className="text-sm capitalize text-zinc-600 dark:text-zinc-400">
          {row.cargo}
        </span>
      ),
    },
    {
      key: 'faturamento',
      header: 'Faturamento',
      render: (row: Lead) => (
        <span className="text-sm font-medium">
          {formatFaturamento(row.faturamento)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Solicitado em',
      render: (row: Lead) => (
        <span className="text-xs text-zinc-500">
          {formatDate(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Lead) => {
        const s = (row.status ?? 'PENDING') as LeadStatus;
        return <Badge value={s}>{STATUS_LABELS[s]}</Badge>;
      },
    },
    {
      key: 'actions',
      header: '',
      render: (row: Lead) => {
        if (row.status !== 'PENDING') return null;
        const isLoading = actionLoading === row.id;
        return (
          <div className="flex items-center justify-center gap-2">
            <button
              disabled={isLoading}
              onClick={(e) => {
                e.stopPropagation();
                handleApprove(row);
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-600 transition-all hover:bg-emerald-500/20 active:scale-95 disabled:opacity-50 dark:text-emerald-400"
            >
              {isLoading ? <Spinner size={12} /> : <CheckCircle size={14} />}
              Aprovar
            </button>
            <button
              disabled={isLoading}
              onClick={(e) => {
                e.stopPropagation();
                handleReject(row);
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1 text-[11px] font-bold text-red-600 transition-all hover:bg-red-500/20 active:scale-95 disabled:opacity-50 dark:text-red-400"
            >
              {isLoading ? <Spinner size={12} /> : <XCircle size={14} />}
              Rejeitar
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Excluir solicitações
            </h2>
            <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
              Excluir permanentemente{' '}
              <span className="font-semibold">
                {deletableLeads.length} solicitação(ões)
              </span>{' '}
              aprovada(s) ou rejeitada(s)? Solicitações pendentes não serão
              excluídas.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={actionLoading === 'bulk-delete'}
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-60 dark:border-white/10 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={actionLoading === 'bulk-delete'}
                onClick={handleDeleteSelected}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {actionLoading === 'bulk-delete' ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        .premium-page { font-family: 'Inter', sans-serif; }
      `}</style>

      <div className="premium-page relative flex h-full min-h-0 flex-col gap-6">
        {/* Ambient glows matching dashboard */}
        <div className="pointer-events-none fixed left-[220px] top-20 z-0 h-[400px] w-[400px] rounded-full bg-purple-500/5 blur-[80px]" />
        <div className="pointer-events-none fixed bottom-20 right-20 z-0 h-[300px] w-[300px] rounded-full bg-blue-500/5 blur-[60px]" />

        <div className="relative z-10 flex flex-1 flex-col gap-6 min-h-0">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Solicitações de cadastro
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Gerencie os leads que solicitaram acesso ao Simintpay.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-10 items-center gap-1 rounded-lg bg-white/50 p-1 backdrop-blur-sm dark:bg-white/5">
              {statusOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setStatusFilter(opt.value);
                    setPage(1);
                    setSelectedIds(new Set());
                  }}
                  className={[
                    'h-8 rounded-md px-3 text-sm font-medium transition-all',
                    statusFilter === opt.value
                      ? 'bg-white text-zinc-950 shadow-sm dark:bg-white/10 dark:text-white'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
                  ].join(' ')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {selectedLeads.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <span className="mr-2 text-sm font-semibold text-red-700 dark:text-red-300">
                {selectedLeads.length} selecionada(s)
              </span>
              <button
                type="button"
                disabled={
                  deletableLeads.length === 0 || actionLoading === 'bulk-delete'
                }
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300"
              >
                <Trash2 className="h-4 w-4" /> Excluir ({deletableLeads.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-semibold text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
              >
                <X className="h-4 w-4" /> Limpar
              </button>
            </div>
          )}

          <DataTable
            columns={columns}
            rows={data.data}
            loading={loading || loadingUser}
            emptyTitle="Nenhuma solicitação encontrada"
            emptyDescription="Aguardando novos cadastros pelo formulário."
            page={page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(nextPage) => {
              setPage(nextPage);
              setSelectedIds(new Set());
            }}
            selectable
            getRowId={(lead) => lead.id}
            selectedIds={selectedIds}
            onToggleRow={toggleLead}
            onToggleAll={toggleAllLeads}
          />
        </div>
      </div>
    </>
  );
}
