'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Calendar,
  CalendarClock,
  CreditCard,
  Hash,
  IdCard,
  Link2,
  Loader2,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import {
  cancelAssinante,
  getSubscriptionDetail,
} from '@/features/assinantes/services/assinantes.service';
import { formatBrl } from '../utils';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v))
    return v as Record<string, unknown>;
  return null;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v || '—';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '—';
}

function formatIsoDate(v: unknown): string {
  const s = str(v);
  if (s === '—') return s;
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return s;
  }
}

function formatDateOnly(v: unknown): string {
  const s = str(v);
  if (s === '—' || !s.trim()) return '—';
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString('pt-BR');
  } catch {
    return s;
  }
}

function maskToken(s: string): string {
  if (!s || s === '—') return '—';
  if (s.length <= 12) return '••••••••';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function paymentMethodLabel(raw: string): string {
  const x = raw.toLowerCase();
  if (x === 'credit_card') return 'Cartão de crédito';
  if (x === 'pix') return 'PIX';
  if (x === 'boleto') return 'Boleto';
  return raw || '—';
}

function frequencyLabel(ft: string, freq: number): string {
  const t = (ft || '').toUpperCase();
  const n = freq || 1;
  if (t === 'MONTH' || t === 'MONTHLY')
    return n === 1 ? 'Mensal' : `A cada ${n} meses`;
  if (t === 'YEAR' || t === 'YEARLY')
    return n === 1 ? 'Anual' : `A cada ${n} anos`;
  if (t === 'WEEK' || t === 'WEEKLY')
    return n === 1 ? 'Semanal' : `A cada ${n} semanas`;
  return `${ft || '—'} (${n})`;
}

export default function AssinanteDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const { toast } = useToast();

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

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['assinante-detail', id],
    queryFn: () => getSubscriptionDetail(api, id),
    enabled: Boolean(id),
  });

  const auto = asRecord(data?.auto_recurring);
  const card = asRecord(data?.card);

  const description = auto?.description ?? data?.external_reference ?? data?.id;
  const value =
    typeof auto?.value === 'number' ? auto.value : Number(auto?.value ?? NaN);
  const freqType = str(auto?.frequency_type);
  const freq =
    typeof auto?.frequency === 'number'
      ? auto.frequency
      : Number(auto?.frequency ?? 1);
  const statusRaw = str(data?.status);
  const statusLabel = statusRaw ? statusRaw.replace(/_/g, ' ') : '—';

  const [rawOpen, setRawOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: () => cancelAssinante(api, id),
    onSuccess: async () => {
      toast({
        type: 'success',
        title: 'Assinatura desativada',
        description: 'A assinatura foi desativada com sucesso.',
      });
      setConfirmOpen(false);
      await refetch();
    },
    onError: (err) => {
      const message =
        err instanceof Error
          ? err.message
          : 'Não foi possível desativar a assinatura.';
      toast({ type: 'error', title: 'Erro', description: message });
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Link
          href="/planos"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Planos de assinaturas
        </Link>
        <span className="mx-2 text-zinc-400">&gt;</span>
        <Link
          href="/assinantes"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Seus assinantes
        </Link>
      </nav>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando assinatura…
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-6 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <p className="font-semibold">
            Não foi possível carregar a assinatura.
          </p>
          <p className="mt-1 opacity-90">
            {error instanceof Error ? error.message : 'Erro desconhecido'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium dark:border-red-400/40"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
            />
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                {str(description)}
              </h1>
              <p className="mt-1 font-mono text-xs text-zinc-500">{id}</p>
            </div>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase ${
                statusRaw.toLowerCase() === 'active'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
                  : 'bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300'
              }`}
            >
              {statusLabel}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.push('/assinantes')}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/10"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={
                  statusRaw.toLowerCase() !== 'active' ||
                  cancelMutation.isPending
                }
                onClick={() => setConfirmOpen(true)}
                className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
              >
                {cancelMutation.isPending
                  ? 'Desativando...'
                  : 'Desativar assinatura'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/40 bg-zinc-50/50 p-4 shadow-[0_12px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-200/70 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Plano e recorrência
                </h2>
                <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <p className="flex items-start gap-2">
                    <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                    <span>{str(description)}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 shrink-0 text-zinc-400" />
                    {Number.isFinite(value) ? formatBrl(value) : '—'}
                  </p>
                  <p className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 shrink-0 text-zinc-400" />
                    {frequencyLabel(freqType, Number.isFinite(freq) ? freq : 1)}
                  </p>
                  <p className="flex items-center gap-2">
                    <Hash className="h-4 w-4 shrink-0 text-zinc-400" />
                    Ciclo atual: {str(data?.current_cycle)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200/70 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Pagamento
                </h2>
                <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <p className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 shrink-0 text-zinc-400" />
                    {paymentMethodLabel(str(data?.payment_method))}
                  </p>
                  {card && (
                    <p className="flex items-center gap-2 pl-6 text-xs text-zinc-500">
                      Parcelas: {str(card.installments)}
                    </p>
                  )}
                  {card && typeof card.token === 'string' && (
                    <p className="flex items-center gap-2 font-mono text-xs text-zinc-500">
                      Token: {maskToken(card.token)}
                    </p>
                  )}
                  <p className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 shrink-0 text-zinc-400" />
                    Início faturamento:{' '}
                    {formatDateOnly(data?.start_date_invoice)}
                  </p>
                  <p className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 shrink-0 text-zinc-400" />
                    Próxima fatura: {formatDateOnly(data?.next_date_invoice)}
                  </p>
                  {str(data?.end_date_invoice) !== '—' ? (
                    <p className="flex items-center gap-2 text-zinc-500">
                      Término: {formatDateOnly(data?.end_date_invoice)}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200/70 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Identificadores
                </h2>
                <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <p className="flex items-start gap-2 break-all">
                    <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                    <span>
                      <span className="text-zinc-500">Assinatura:</span>{' '}
                      {str(data?.id)}
                    </span>
                  </p>
                  <p className="flex items-start gap-2 break-all">
                    <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                    <span>
                      <span className="text-zinc-500">Cliente:</span>{' '}
                      {str(data?.customer_id)}
                    </span>
                  </p>
                  <p className="flex items-start gap-2 break-all">
                    <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                    <span>
                      <span className="text-zinc-500">Plano:</span>{' '}
                      {str(data?.plan_id)}
                    </span>
                  </p>
                  <p className="flex items-start gap-2">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="break-all text-xs">
                      {str(data?.postbackurl)}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-500">
                    Criado: {formatIsoDate(data?.created_at)} · Atualizado:{' '}
                    {formatIsoDate(data?.updated_at)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {Array.isArray(data?.platform) &&
          (data?.platform as unknown[]).length > 0 ? (
            <div className="rounded-2xl border border-white/40 bg-zinc-50/50 p-4 dark:border-white/10 dark:bg-white/5">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                Plataforma / taxas
              </h2>
              <pre className="max-h-48 overflow-auto rounded-lg border border-zinc-200 bg-white/80 p-3 text-xs text-zinc-700 dark:border-white/10 dark:bg-zinc-900/40 dark:text-zinc-300">
                {JSON.stringify(data?.platform, null, 2)}
              </pre>
            </div>
          ) : null}

          {str(data?.metadata) !== '—' ? (
            <div className="rounded-2xl border border-white/40 bg-zinc-50/50 p-4 dark:border-white/10 dark:bg-white/5">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                Metadata
              </h2>
              <p className="break-all text-sm text-zinc-700 dark:text-zinc-300">
                {str(data?.metadata)}
              </p>
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/40 bg-zinc-50/50 p-4 dark:border-white/10 dark:bg-white/5">
            <button
              type="button"
              onClick={() => setRawOpen((v) => !v)}
              className="text-sm font-medium text-emerald-700 dark:text-emerald-400"
            >
              {rawOpen ? 'Ocultar' : 'Ver'} resposta JSON completa
            </button>
            {rawOpen ? (
              <pre className="mt-3 max-h-[min(420px,50vh)] overflow-auto rounded-lg border border-zinc-200 bg-white/90 p-3 text-xs dark:border-white/10 dark:bg-zinc-950/60">
                {JSON.stringify(data, null, 2)}
              </pre>
            ) : null}
          </div>
        </>
      )}
      <ConfirmDeleteDialog
        open={confirmOpen}
        title="Desativar assinatura"
        description="Tem certeza que deseja desativar esta assinatura? Esta ação cancela a recorrência no gateway."
        confirmLabel="Desativar"
        cancelLabel="Cancelar"
        loading={cancelMutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => cancelMutation.mutate()}
      />
    </div>
  );
}
