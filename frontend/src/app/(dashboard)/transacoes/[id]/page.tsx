'use client';

import { InfoRow } from './components';
import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  History,
  Package,
  Search,
  Smartphone,
  User,
  Wallet,
  RefreshCcw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';

import { formatTransacaoDescricaoUi, transacaoPlataformaUi } from '@/lib/utils';
import { PlatformBadges } from '@/components/ui/PlatformBadges';
import { Badge } from '@/components/ui/Badge';
import { CopyButton } from '@/components/ui/CopyButton';
import { StatusTimeline } from '@/components/ui/StatusTimeline';
import { useToast } from '@/components/ui/Toast';
import { ActionButton } from '../../relatorio/components/ActionButton';

import { useTransacaoDetail } from '@/features/transacoes/hooks/use-transacao-detail';
import { useCurrentUser } from '@/hooks/use-current-user';

function formatBRL(
  value: number | string | undefined | null,
  maximumFractionDigits = 2,
) {
  const v = Number(value ?? 0);
  if (isNaN(v)) return 'R$ 0,00';
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits,
  });
}

function safeNum(value: number | string | undefined | null): number {
  const v = Number(value ?? 0);
  return isNaN(v) ? 0 : v;
}

function formatDateTime(value: string | undefined | null) {
  if (!value) return '-';
  // Dom API returns dates as "YYYY-MM-DD HH:MM:SS" already in Brazil time.
  // Extract parts directly to avoid any timezone conversion.
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    return `${day}/${month}/${year}, ${hour}:${minute}`;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TransacaoDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { toast } = useToast();
  const { data, loading, error } = useTransacaoDetail(id);
  const { user, loading: loadingUser } = useCurrentUser();
  const isAdmin = user?.isAdmin ?? false;

  const order = data?.order;

  const timelineItems = useMemo(() => {
    const items = order?.historic_status ?? [];
    // The image shows descending 2, 1
    // We reverse if the API returns chronologically or vice versa
    // DOM usually returns items in order, let's just reverse for the descending look (2, 1)
    return [...items].reverse().map((it, idx, arr) => ({
      title: (
        <div className="flex items-center gap-2">
          <span className="font-semibold">{it.status}</span>
        </div>
      ),
      description: formatDateTime(it.date),
      // we can use it.id for custom markers if needed
    }));
  }, [order?.historic_status]);

  if (loading || loadingUser) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-8 w-48 bg-zinc-200 dark:bg-white/10 rounded-lg" />
        <div className="h-40 w-full bg-zinc-200 dark:bg-white/10 rounded-3xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="h-32 bg-zinc-200 dark:bg-white/10 rounded-2xl" />
          <div className="h-32 bg-zinc-200 dark:bg-white/10 rounded-2xl" />
          <div className="h-32 bg-zinc-200 dark:bg-white/10 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-4 rounded-full bg-red-50 dark:bg-red-500/10 text-red-500 mb-4">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Ops! Ocorreu um erro</h2>
        <p className="text-zinc-500 mb-6">
          {error?.message ||
            'Não foi possível carregar os detalhes desta transação.'}
        </p>
        <ActionButton onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          Voltar para Transações
        </ActionButton>
      </div>
    );
  }

  const statusType = order.type?.toUpperCase();
  const isPix = order.type_payment?.toUpperCase() === 'PIX';
  const valorBrutoVenda = safeNum(order.valor_bruto_venda ?? order.total);
  const taxaDom = safeNum(order.taxa_dom ?? order.mdr_value);
  const taxaFixaTransacao = safeNum(order.taxa_fixa_transacao ?? 1);
  const taxaCashback = safeNum(order.taxa_cashback ?? 3);
  const taxaVendedor = safeNum(
    order.taxa_vendedor ??
      order.fee_total_value - taxaDom - taxaFixaTransacao - taxaCashback,
  );
  const lucroMaster = safeNum(
    order.lucro_master ?? order.valor_liquido_vendedor ?? order.total_liquid,
  );

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full pb-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-xl border border-white/40 bg-white/70 hover:bg-white shadow-sm dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 transition-all hover:-translate-x-1"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Detalhes da transação
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Veja os dados completos da operação
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3"></div>
      </div>

      {/* Main Top Card */}
      <div className="overflow-hidden rounded-[2rem] border border-white/40 bg-zinc-50 shadow-[0_12px_44px_-24px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x border-white/20 dark:divide-white/10">
          {/* Left section: ID & Basic info */}
          <div className="lg:w-1/3 p-8 bg-emerald-600 dark:bg-emerald-700 text-white relative flex flex-col justify-between overflow-hidden">
            {/* Background flourish */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-100/70">
                    Código da transação
                  </div>
                  <Badge value={order.type}>
                    {order.type_payment || 'Aprovado'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 group">
                  <span className="text-lg font-mono font-semibold truncate">
                    {id}
                  </span>
                  <CopyButton
                    value={id}
                    size={32}
                    iconOnly
                    className="opacity-0 group-hover:opacity-100 bg-white/10 border-white/20 text-white hover:bg-white/20"
                  />
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-100/70 mb-1">
                  Código de referência
                </div>
                <div className="flex items-center gap-2 group">
                  <span className="text-sm font-medium opacity-90 truncate">
                    {order.id_transaction}
                  </span>
                  <CopyButton
                    value={String(order.id_transaction ?? '')}
                    size={28}
                    iconOnly
                    className="opacity-0 group-hover:opacity-100 bg-white/10 border-white/20 text-white hover:bg-white/20"
                  />
                </div>
              </div>
            </div>

            <div className="relative mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-6">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/50">
                  Data de criação
                </div>
                <div className="mt-0.5 text-xs font-medium">
                  {formatDateTime(order.date_register)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/50">
                  Método de captura
                </div>
                <div className="mt-0.5 text-xs font-medium">{order.origin}</div>
              </div>
            </div>
          </div>

          {/* Center/Right sections: Amounts */}
          <div className="flex-1 p-8 grid md:grid-cols-3 gap-10 items-center bg-white/50 backdrop-blur-xl dark:bg-transparent">
            {/* Total Sale */}
            <div className="flex flex-col items-center lg:items-start">
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-2">
                <Wallet className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Total da venda
                </span>
              </div>
              <div className="text-3xl lg:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-zinc-900 to-zinc-600 dark:from-white dark:to-zinc-400">
                {formatBRL(valorBrutoVenda)}
              </div>
            </div>

            {/* Total Fees */}
            <div className="flex flex-col items-center lg:items-start relative">
              {/* Vertical divider for md only */}
              <div className="hidden md:block absolute -left-5 top-0 bottom-0 w-px bg-zinc-200 dark:bg-white/10" />
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-2">
                <Search className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Total de taxas
                </span>
              </div>
              <div className="text-3xl lg:text-4xl font-bold text-zinc-800 dark:text-zinc-200">
                {formatBRL(order.fee_total_value)}
              </div>
              {isAdmin && (
                <div className="mt-2 text-[10px] font-medium text-zinc-500 flex flex-wrap gap-2">
                  <span>Taxa DOM: {formatBRL(taxaDom)}</span>
                  <span className="opacity-50">•</span>
                  <span>Taxa vendedor: {formatBRL(taxaVendedor)}</span>
                  <span className="opacity-50">•</span>
                  <span>Taxa fixa: {formatBRL(taxaFixaTransacao)}</span>
                  <span className="opacity-50">•</span>
                  <span>Cashback: {formatBRL(taxaCashback)}</span>
                </div>
              )}
            </div>

            {/* Lucro / Prejuízo (mesmo valor que líquido vendedor na API) */}
            <div className="flex flex-col items-center lg:items-start relative">
              <div className="hidden md:block absolute -left-5 top-0 bottom-0 w-px bg-zinc-200 dark:bg-white/10" />
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-2">
                <History className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Lucro/Prejuízo
                </span>
              </div>
              <div
                className={`text-3xl lg:text-4xl font-bold ${
                  lucroMaster >= 0
                    ? 'text-violet-600 dark:text-violet-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatBRL(lucroMaster)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid for details cards */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Payment Details */}
        <div className="lg:col-span-4 rounded-3xl border border-white/40 bg-white/70 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-white/5 pb-4 mb-6">
            <Smartphone className="h-4 w-4 text-zinc-400" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-900 dark:text-zinc-100 px-1">
              Detalhes do pagamento
            </h3>
          </div>

          <div className="space-y-6">
            <InfoRow label="Pagamento no" value={order.type_payment} />
            <InfoRow
              label="Data do pagamento"
              value={
                order.paid_date ? formatDateTime(order.paid_date) : 'Não pago'
              }
            />
            {isAdmin && (
              <InfoRow
                label="Status 3DS"
                value={order.msg_3ds || 'Não solicitado'}
              />
            )}

            {isPix && order.pix_content && (
              <InfoRow
                label="Chave copia e cola"
                value={order.pix_content}
                right={<CopyButton value={order.pix_content} />}
              />
            )}
          </div>
        </div>

        {/* Buyer Details */}
        <div className="lg:col-span-4 rounded-3xl border border-white/40 bg-white/70 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-white/5 pb-4 mb-6">
            <User className="h-4 w-4 text-zinc-400" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-900 dark:text-zinc-100 px-1">
              Detalhes do comprador
            </h3>
          </div>

          <div className="space-y-6">
            <InfoRow
              label="Nome"
              value={order.client_name}
              right={
                <CopyButton value={String(order.client_name ?? '')} iconOnly />
              }
            />
            <InfoRow
              label="Documento"
              value={order.client_document}
              right={
                <CopyButton
                  value={String(order.client_document ?? '')}
                  iconOnly
                />
              }
            />
            <InfoRow
              label="Telefone"
              value={order.client_phone}
              right={
                <div className="flex items-center gap-1">
                  <CopyButton
                    value={String(order.client_phone ?? '')}
                    iconOnly
                  />
                  {order.client_phone && (
                    <a
                      href={`https://wa.me/${order.client_phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:text-zinc-400 transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              }
            />
            <InfoRow
              label="E-mail"
              value={order.client_email}
              right={
                <CopyButton value={String(order.client_email ?? '')} iconOnly />
              }
            />
          </div>
        </div>

        {/* Order Items & Timeline */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Order Items */}
          <div className="rounded-3xl border border-white/40 bg-white/70 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-white/5 pb-4 mb-4">
              <Package className="h-4 w-4 text-zinc-400" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-900 dark:text-zinc-100 px-1">
                Itens do pedido
              </h3>
            </div>

            <div className="divide-y divide-zinc-100 dark:divide-white/5">
              {order.items?.map((item, idx) => (
                <div
                  key={idx}
                  className="py-3 flex items-center justify-between gap-4 group"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-zinc-400">
                      {item.quant}x
                    </div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {formatTransacaoDescricaoUi(item.name) || '—'}
                    </div>
                    {transacaoPlataformaUi(undefined, item.name) && (
                      <PlatformBadges
                        platforms={[
                          transacaoPlataformaUi(undefined, item.name)!,
                        ]}
                      />
                    )}
                  </div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatBRL(item.price * item.quant)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div className="rounded-3xl border border-white/40 bg-white/70 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5 flex-1">
            <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-white/5 pb-4 mb-6">
              <History className="h-4 w-4 text-zinc-400" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-900 dark:text-zinc-100 px-1">
                Histórico da transação
              </h3>
            </div>

            <StatusTimeline items={timelineItems} />
          </div>
        </div>
      </div>
    </div>
  );
}
