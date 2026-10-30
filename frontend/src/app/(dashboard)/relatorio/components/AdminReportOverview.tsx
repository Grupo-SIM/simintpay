'use client';

import { useState, useMemo } from 'react';
import {
  TrendingUp,
  Wallet,
  ArrowUpRight,
  Percent,
  RefreshCw,
  Activity,
  CreditCard,
  Banknote,
  Users,
  Hash,
  Receipt,
  Building2,
  Gift,
  Clock,
  Target,
  DollarSign,
  HelpCircle,
} from 'lucide-react';
import { Tooltip as TooltipRadix } from 'radix-ui';
import { useReportQuery as useQuery } from '@/hooks/use-report-api';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { formatBRL, cn, negativeMoneyClass } from '@/lib/utils';
import type { DateRange } from '../types';
import { transacaoDistribuicaoTemDados } from '../utils';
import {
  applyLucroSimpayDetalheConsolidadoMerges,
  unwrapConsolidadoPayload,
} from '../utils/consolidadoLucroMerge';
import { AdminReportMovements } from './AdminReportMovements';
import { OwnedReportSeries } from './OwnedReportSeries';
import { ReportResultsTable } from './ReportResultsTable';
import { ReportSkeleton } from './ReportSkeleton';
import { ReportError } from './ReportError';
import { ReportMetricSection } from './ReportMetricSection';
import { MetricCard } from './MetricCard';
import { type LucroSimpayDetalhe } from './LucroSimpayDetalhePanel';
import { TransactionDistributionCard } from './TransactionDistributionCard';
import { ReportDistributionPieCard } from './ReportDistributionPieCard';
import { LucroSimpayPlataformaBarCard } from './LucroSimpayPlataformaBarCard';
import type { TransacaoDistribuicaoResponse } from '../types';

const DEFAULT_PERIOD_TYPE = 'settlement' as const;
const DEFAULT_TRANSACTION_TYPE = 'all' as const;

function formatQueryDate(d: Date | null): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Textos curtos dos tooltips dos cards de métricas — uma linha por card. */
const METRIC_TT = {
  totalTransacoes: 'Transações aprovadas no período.',
  receitaTotal: 'Valor bruto das vendas aprovadas.',
  taxaAdquirenteProxima: 'Reservado para futura adquirente.',
  valorLiquido: 'Líquido total das transações.',
  lucroLiquido:
    'Lucro das transações + receita de taxas de saque − custos de saque.',
  roi: 'Lucro líquido ÷ receita total.',
  totalRepasse:
    'Líquido das vendas destinado aos donos das plataformas, incluindo o Grupo SIM.',
  saquesAprovados: 'Saques aprovados. Ícone alterna quantidade/valor.',
  saquesPendentes: 'Saques aguardando aprovação.',
  lucroSaque: 'Arrecadado com taxas de saque.',
  taxaSaqueDOM: 'Custo DOM por saque: R$ 3,50 cada.',
  estornos: 'Estornos. Ícone alterna quantidade/valor.',
  quantidadeClientes:
    'Compradores únicos por CPF nas vendas aprovadas do período. Compras sem CPF não entram na contagem.',
  // ── Bloco DOM ──
  mdrDom: 'MDR percentual da DOM (varia por método e parcela).',
  taxaFixaDom: 'R$ 1 por transação cobrado pela DOM.',
  taxaCashbackDom: 'R$ 3 por transação de cashback DOM.',
  totalTaxasDom: 'Custo DOM total: MDR + R$ 1 + R$ 3 por transação.',
  // ── Bloco Sim Int Pay ──
  taxaSimIntPct: 'Margem percentual da Sim Int Pay, já sem o MDR DOM.',
  taxaServicoDom: 'R$ 4 por transação cobrados pela Sim Int Pay.',
  totalTaxasSimInt: 'Receita Sim Int Pay: margem % + taxa por transação.',
} as const;

type ConsolidadoResponse = {
  valorBruto?: number;
  lucroTotalMaster?: number;
  taxaDom?: number;
  custoCashback?: number;
  taxaSimInt?: number;
  totalTransacoes?: number;
  totalRepasseConsolidado?: number;
  customersCount?: number;
  taxaParcelamentoBruto?: number;
  taxaParcelamentoSimIntPay?: number;
  taxaSaqueDOM?: number;
  saquesAprovados?: { valor?: number; quantidade?: number };
  naoIdentificadas?: { valor?: number; quantidade?: number };
};

export default function AdminReportOverview({
  range,
  method = 'all',
}: {
  range: DateRange;
  method?: string;
}) {
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      }),
    [],
  );

  const filters = { periodPreset: 'custom', detalharLucro: true };
  const effectiveDateRange = range;
  const [showSaqueValue, setShowSaqueValue] = useState(false);
  const {
    data: consolidado,
    isLoading: isLoadingConsolidado,
    isFetching: isFetchingConsolidado,
    isError: consolidadoError,
    refetch: retryConsolidado,
  } = useQuery({
    queryKey: [
      'consolidado',
      method,
      DEFAULT_PERIOD_TYPE,
      filters.periodPreset,
      formatQueryDate(effectiveDateRange.start),
      formatQueryDate(effectiveDateRange.end),
      DEFAULT_TRANSACTION_TYPE,
      filters.detalharLucro,
    ],
    queryFn: async () => {
      return api.get<ConsolidadoResponse>(endpoints.relatorios.consolidado, {
        query: {
          metodoPagamento: method === 'all' ? undefined : method,
          periodType: DEFAULT_PERIOD_TYPE,
          dataInicio: formatQueryDate(effectiveDateRange.start) ?? undefined,
          dataFim: formatQueryDate(effectiveDateRange.end) ?? undefined,
          transactionType: DEFAULT_TRANSACTION_TYPE,
          ...(filters.detalharLucro ? { detalharLucro: '1' } : {}),
        },
      });
    },
  });

  const needsSeparateLucroChartFetch = !filters.detalharLucro;

  const { data: consolidadoLucroChart, isLoading: isLoadingLucroChart } =
    useQuery({
      queryKey: [
        'consolidado-lucro-chart',
        method,
        formatQueryDate(effectiveDateRange.start),
        formatQueryDate(effectiveDateRange.end),
        DEFAULT_PERIOD_TYPE,
        DEFAULT_TRANSACTION_TYPE,
      ],
      enabled: needsSeparateLucroChartFetch,
      queryFn: async () => {
        return api.get<ConsolidadoResponse>(endpoints.relatorios.consolidado, {
          query: {
            metodoPagamento: method === 'all' ? undefined : method,
            periodType: DEFAULT_PERIOD_TYPE,
            dataInicio: formatQueryDate(effectiveDateRange.start) ?? undefined,
            dataFim: formatQueryDate(effectiveDateRange.end) ?? undefined,
            transactionType: DEFAULT_TRANSACTION_TYPE,
            detalharLucro: '1',
          },
        });
      },
    });

  const lucroDetalheGrafico = useMemo((): LucroSimpayDetalhe | null => {
    const payload = filters.detalharLucro ? consolidado : consolidadoLucroChart;
    const root = unwrapConsolidadoPayload(payload);
    const raw = root.lucroSimpayDetalhe;
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as LucroSimpayDetalhe;
    if (d.soloResumoPlataforma) return null;
    return applyLucroSimpayDetalheConsolidadoMerges(d, payload);
  }, [filters.detalharLucro, consolidado, consolidadoLucroChart]);

  const ymdInicioGrafico = formatQueryDate(effectiveDateRange.start) ?? '';
  const ymdFimGrafico = formatQueryDate(effectiveDateRange.end) ?? '';

  const loadingLucroPlataformaChart = filters.detalharLucro
    ? isLoadingConsolidado
    : isLoadingLucroChart;

  const { data: saquesPendentesData, isLoading: isLoadingSaquesPendentes } =
    useQuery({
      queryKey: ['saques-pendentes-admin'],
      staleTime: 60_000,
      queryFn: async () => {
        return api.get<{ total: number }>(endpoints.admin.saques.list, {
          query: { status: 'PENDING', pageSize: '1' },
        });
      },
    });

  type MensalRow = {
    mes: string;
    vendas?: number;
    valorBruto: number;
    taxaAdquirente: number;
    lucroLiquido: number;
    totalRepassado: number;
  };

  const mensalQueryParams = {
    dataInicio: formatQueryDate(range.start) ?? undefined,
    dataFim: formatQueryDate(range.end) ?? undefined,
    metodoPagamento: method === 'all' ? undefined : method,
  };

  const {
    data: mensalData,
    isLoading: isLoadingMensal,
    isError: mensalError,
    refetch: retryMensal,
  } = useQuery({
    queryKey: ['relatorio-mensal', mensalQueryParams],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      api.get<{ meses: MensalRow[] }>(endpoints.relatorios.mensal, {
        query: mensalQueryParams,
      }),
  });

  const distQueryOpts = useMemo(
    () => ({
      dataInicio: formatQueryDate(effectiveDateRange.start) ?? undefined,
      dataFim: formatQueryDate(effectiveDateRange.end) ?? undefined,
    }),
    [effectiveDateRange.start, effectiveDateRange.end],
  );

  const { data: porStatusData, isLoading: isLoadingPorStatus } = useQuery({
    queryKey: [
      'report-dist-status',
      filters.periodPreset,
      formatQueryDate(effectiveDateRange.start),
      formatQueryDate(effectiveDateRange.end),
    ],
    queryFn: async () => {
      return api.get<TransacaoDistribuicaoResponse>(
        endpoints.relatorios.transacoesPorStatus,
        {
          query: distQueryOpts,
        },
      );
    },
  });

  const { data: porMetodoData, isLoading: isLoadingPorMetodo } = useQuery({
    queryKey: [
      'report-dist-metodo',
      filters.periodPreset,
      formatQueryDate(effectiveDateRange.start),
      formatQueryDate(effectiveDateRange.end),
    ],
    queryFn: async () => {
      return api.get<TransacaoDistribuicaoResponse>(
        endpoints.relatorios.transacoesPorMetodo,
        {
          query: distQueryOpts,
        },
      );
    },
  });

  const carregandoDistribuicao = isLoadingPorStatus || isLoadingPorMetodo;

  const consolidadoResolvido = !isLoadingConsolidado && !isFetchingConsolidado;
  const valorBrutoConsolidado = Number(consolidado?.valorBruto ?? 0);
  /** Mesma base dos cards: sem movimento no período → não exibir gráficos mesmo se distribuição vier incoerente. */
  const suprimirGraficosPeloConsolidado =
    consolidadoResolvido &&
    Number.isFinite(valorBrutoConsolidado) &&
    valorBrutoConsolidado <= 0;

  const temTransacoesDistrib =
    !carregandoDistribuicao &&
    (transacaoDistribuicaoTemDados(porStatusData) ||
      transacaoDistribuicaoTemDados(porMetodoData));

  const temTransacoesNoPeriodo =
    !suprimirGraficosPeloConsolidado && temTransacoesDistrib;

  const roiFormatado = (() => {
    if (isLoadingConsolidado) return 'Carregando...';
    const bruto = consolidado?.valorBruto ?? 0;
    if (!bruto) return '—';
    return `${(((consolidado?.lucroTotalMaster ?? 0) / bruto) * 100).toFixed(2)}%`;
  })();

  // ── Derivados de taxas DOM / Sim Int Pay ──────────────────────────────────
  const _taxaDom = Number(consolidado?.taxaDom ?? 0);
  const _cashback = Number(consolidado?.custoCashback ?? 0);
  const _taxaSimInt = Number(consolidado?.taxaSimInt ?? 0);

  // Recorte só de boleto (enviado pelo backend no consolidado).
  const boletoResumo = (consolidado as Record<string, unknown>)?.boleto as
    | {
        quantidade: number;
        valorBruto: number;
        taxaDom: number;
        taxaSimIntPay: number;
        lucro: number;
      }
    | undefined;

  /**
   * MDR DOM: campo enviado pelo backend quando disponível (taxaDomMdr).
   * Enquanto não existe no consolidado, fica nulo — não usamos taxa hardcoded
   * pois cada plataforma/tipo de pagamento tem MDR diferente (PIX=0,98%, CC varia por parcela).
   */
  const mdrDom: number | null =
    (consolidado as Record<string, unknown>)?.taxaDomMdr != null
      ? Number((consolidado as Record<string, unknown>).taxaDomMdr)
      : null;

  /** R$1 fixo DOM por transação = taxaDom (R$4×N) − custoCashback (R$3×N). */
  const taxaFixaTransacaoDom = Math.round((_taxaDom - _cashback) * 100) / 100;

  /**
   * Total DOM = fixos (R$4×N) + MDR percentual.
   * Se backend ainda não envia taxaDomMdr, mostra apenas os fixos com nota no tooltip.
   */
  const totalTaxasDom =
    mdrDom != null ? Math.round((_taxaDom + mdrDom) * 100) / 100 : _taxaDom;

  /**
   * Taxa % líquida Sim Int Pay = taxaSimInt (valorBruto − valorLíquido, bruto de todas as %)
   * menos MDR DOM se disponível, caso contrário menos taxaDom (fixos) como melhor aproximação.
   * A fórmula exata por transação é: (1 − LIQUIDEZ_plataforma) × valor − MDR_tipo_pagamento.
   * Plataformas têm LIQUIDEZ configurável (ex: GLOBAL=9%, ATLAS=14%) e tipos de pagamento
   * têm MDR distintos (PIX=0,98%, CC_1x=3,99%, CC_10x=18,64%), portanto o cálculo preciso
   * requer o campo taxaDomMdr do backend.
   */
  const taxaSimIntPct =
    mdrDom != null
      ? Math.round((_taxaSimInt - mdrDom) * 100) / 100
      : Math.round((_taxaSimInt - _taxaDom) * 100) / 100;

  /** TAXA_SERVICO agregada (R$4×N elegíveis). Campo enviado pelo backend quando disponível. */
  const taxaServicoTotal = Number(
    (consolidado as Record<string, unknown>)?.taxaServico ?? 0,
  );

  /** Total Sim Int Pay = % líquida + taxa serviço por transação. */
  const totalTaxasSimInt =
    Math.round((taxaSimIntPct + taxaServicoTotal) * 100) / 100;

  if (isLoadingConsolidado) return <ReportSkeleton />;
  if (consolidadoError)
    return <ReportError retry={() => void retryConsolidado()} />;
  return (
    <TooltipRadix.Provider delayDuration={200}>
      <div className="flex flex-col gap-8">
        {/* ── Visão Geral ── */}
        <ReportMetricSection title="Visão Geral">
          <MetricCard
            label="Total de transações"
            tooltip={METRIC_TT.totalTransacoes}
            value={
              isLoadingConsolidado
                ? 'Carregando...'
                : (consolidado?.totalTransacoes ?? 0).toLocaleString('pt-BR')
            }
            valueClassName="text-sky-600 dark:text-sky-400"
            icon={Hash}
            iconClassName="text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400"
          />
          <MetricCard
            label="Receita Total"
            tooltip={METRIC_TT.receitaTotal}
            value={
              isLoadingConsolidado
                ? 'Carregando...'
                : formatBRL(consolidado?.valorBruto)
            }
            valueClassName="text-emerald-600 dark:text-emerald-400"
            icon={TrendingUp}
            iconClassName="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400"
          />
          <MetricCard
            label="Total de repasse"
            tooltip={METRIC_TT.totalRepasse}
            value={
              isLoadingConsolidado
                ? 'Carregando...'
                : formatBRL(consolidado?.totalRepasseConsolidado)
            }
            valueClassName="text-cyan-600 dark:text-cyan-400"
            icon={Banknote}
            iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
          />
          <MetricCard
            label="Quantidade de clientes"
            tooltip={METRIC_TT.quantidadeClientes}
            value={
              isLoadingConsolidado
                ? 'Carregando...'
                : consolidado?.customersCount == null
                  ? 'Não informado'
                  : consolidado.customersCount.toLocaleString('pt-BR')
            }
            valueClassName="text-sky-600 dark:text-sky-400"
            icon={Users}
            iconClassName="text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400"
          />
          <MetricCard
            label="ROI"
            tooltip={METRIC_TT.roi}
            value={roiFormatado}
            valueClassName="text-purple-600 dark:text-purple-400"
            icon={Target}
            iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
          />
          <MetricCard
            label="Lucro líquido"
            tooltip={METRIC_TT.lucroLiquido}
            value={
              isLoadingConsolidado
                ? 'Carregando...'
                : formatBRL(consolidado?.lucroTotalMaster)
            }
            valueClassName="text-amber-600 dark:text-amber-400"
            icon={DollarSign}
            iconClassName="text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400"
          />
        </ReportMetricSection>

        {/* ── Boleto ── */}
        {boletoResumo && boletoResumo.quantidade > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Boleto
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              <MetricCard
                label="Boletos pagos"
                value={
                  isLoadingConsolidado
                    ? 'Carregando...'
                    : boletoResumo.quantidade.toLocaleString('pt-BR')
                }
                valueClassName="text-sky-600 dark:text-sky-400"
                icon={Hash}
                iconClassName="text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400"
              />
              <MetricCard
                label="Bruto em boletos"
                value={
                  isLoadingConsolidado
                    ? 'Carregando...'
                    : formatBRL(boletoResumo.valorBruto)
                }
                valueClassName="text-emerald-600 dark:text-emerald-400"
                icon={TrendingUp}
                iconClassName="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400"
              />
              <MetricCard
                label="Taxa DOM (boleto)"
                tooltip="Custo DOM por boleto pago: R$ 3,49 + R$ 1,00."
                value={
                  isLoadingConsolidado
                    ? 'Carregando...'
                    : formatBRL(boletoResumo.taxaDom)
                }
                valueClassName="text-rose-600 dark:text-rose-400"
                icon={Percent}
                iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
              />
              <MetricCard
                label="Taxa Sim Int Pay (boleto)"
                tooltip="Receita Sim Int Pay nos boletos do período."
                value={
                  isLoadingConsolidado
                    ? 'Carregando...'
                    : formatBRL(boletoResumo.taxaSimIntPay)
                }
                valueClassName="text-indigo-600 dark:text-indigo-400"
                icon={Percent}
                iconClassName="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-400"
              />
              <MetricCard
                label="Lucro em boletos"
                tooltip="Lucro nos boletos: taxa Sim Int Pay − taxa DOM."
                value={
                  isLoadingConsolidado
                    ? 'Carregando...'
                    : formatBRL(boletoResumo.lucro)
                }
                valueClassName="text-cyan-600 dark:text-cyan-400"
                icon={Banknote}
                iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
              />
            </div>
          </section>
        )}

        {/* ── Taxas Sim Int Pay ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Taxas Sim Int Pay
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <MetricCard
              label="Taxa - Sim Int Pay (%)"
              tooltip={METRIC_TT.taxaSimIntPct}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(taxaSimIntPct)
              }
              valueClassName="text-violet-600 dark:text-violet-400"
              icon={Percent}
              iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
            />
            <MetricCard
              label="Taxa por transação - Sim Int Pay"
              tooltip={METRIC_TT.taxaServicoDom}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(taxaServicoTotal)
              }
              valueClassName="text-violet-600 dark:text-violet-400"
              icon={Receipt}
              iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
            />
            <MetricCard
              label="Total de taxas - Sim Int Pay"
              tooltip={METRIC_TT.totalTaxasSimInt}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(totalTaxasSimInt)
              }
              valueClassName="text-violet-700 dark:text-violet-300"
              icon={Wallet}
              iconClassName="text-violet-700 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-300"
            />
          </div>
        </section>

        {/* ── Taxas DOM ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Taxas DOM
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <MetricCard
              label="Taxa - DOM (%)"
              tooltip={METRIC_TT.mdrDom}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : mdrDom != null
                    ? formatBRL(mdrDom)
                    : '—'
              }
              valueClassName="text-rose-600 dark:text-rose-400"
              icon={Percent}
              iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
            />
            <MetricCard
              label="Taxa por transação - DOM"
              tooltip={METRIC_TT.taxaFixaDom}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(taxaFixaTransacaoDom)
              }
              valueClassName="text-rose-600 dark:text-rose-400"
              icon={Hash}
              iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
            />
            <MetricCard
              label="Taxa cashback - DOM"
              tooltip={METRIC_TT.taxaCashbackDom}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(consolidado?.custoCashback)
              }
              valueClassName="text-rose-600 dark:text-rose-400"
              icon={Gift}
              iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
            />
            <MetricCard
              label="Total de taxas - DOM"
              tooltip={METRIC_TT.totalTaxasDom}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(totalTaxasDom)
              }
              valueClassName="text-rose-700 dark:text-rose-300"
              icon={Building2}
              iconClassName="text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300"
            />
          </div>
        </section>

        {/* ── Parcelamento ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Parcelamento
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <MetricCard
              label="Juros brutos"
              tooltip="Total do parcelamento no crédito: MDR DOM + margem Master."
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(consolidado?.taxaParcelamentoBruto ?? 0)
              }
              icon={CreditCard}
              iconClassName="text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400"
              valueClassName="text-amber-600 dark:text-amber-400"
            />
            <MetricCard
              label="Parcelamento - DOM"
              tooltip="Parte do parcelamento repassada à DOM."
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(
                      (consolidado?.taxaParcelamentoBruto ?? 0) -
                        (consolidado?.taxaParcelamentoSimIntPay ?? 0),
                    )
              }
              icon={CreditCard}
              iconClassName="text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300"
              valueClassName="text-rose-700 dark:text-rose-300"
            />
            <MetricCard
              label="Parcelamento - Sim Int Pay"
              tooltip="Margem do parcelamento que fica na Sim Int Pay."
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(consolidado?.taxaParcelamentoSimIntPay ?? 0)
              }
              icon={CreditCard}
              iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
              valueClassName="text-violet-600 dark:text-violet-400"
            />
          </div>
        </section>

        {/* ── Saques ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Saques
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <MetricCard
              label="Saques pendentes"
              tooltip={METRIC_TT.saquesPendentes}
              value={
                isLoadingSaquesPendentes
                  ? 'Carregando...'
                  : `${saquesPendentesData?.total ?? 0} pendentes`
              }
              valueClassName="text-orange-600 dark:text-orange-400"
              icon={Clock}
              iconClassName="text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400"
            />
            <MetricCard
              label="Saques aprovados"
              tooltip={METRIC_TT.saquesAprovados}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : showSaqueValue
                    ? formatBRL(consolidado?.saquesAprovados?.valor)
                    : `${consolidado?.saquesAprovados?.quantidade ?? 0} aprovados`
              }
              valueClassName="text-amber-500"
              icon={ArrowUpRight}
              iconClassName="text-amber-500 bg-amber-50 dark:bg-amber-950/30"
              onAction={() => setShowSaqueValue(!showSaqueValue)}
              actionIcon={RefreshCw}
            />
            <MetricCard
              label="Taxa de Saque — DOM"
              tooltip={METRIC_TT.taxaSaqueDOM}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(consolidado?.taxaSaqueDOM)
              }
              valueClassName="text-rose-600 dark:text-rose-400"
              icon={Building2}
              iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
            />
            <MetricCard
              label="Taxa de Saque — Simintpay"
              tooltip={METRIC_TT.lucroSaque}
              value={
                isLoadingConsolidado
                  ? 'Carregando...'
                  : formatBRL(
                      (consolidado?.saquesAprovados?.quantidade ?? 0) * 2,
                    )
              }
              valueClassName="text-violet-600 dark:text-violet-400"
              icon={Wallet}
              iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
            />
          </div>
        </section>

        <AdminReportMovements
          filters={{
            startDate: formatQueryDate(range.start) ?? undefined,
            endDate: formatQueryDate(range.end) ?? undefined,
            paymentMethod: method === 'all' ? undefined : method,
          }}
        />

        <ReportMetricSection title="Atribuição das vendas">
          <MetricCard
            label="Vendas não identificadas"
            value={formatBRL(consolidado?.naoIdentificadas?.valor)}
            detail={`${consolidado?.naoIdentificadas?.quantidade ?? 0} vendas`}
            icon={HelpCircle}
            valueClassName="text-amber-600 dark:text-amber-400"
            iconClassName="text-amber-600 dark:text-amber-400"
          />
        </ReportMetricSection>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* <ReportDistributionPieCard
          title="Distribuição por status"
          subtitle="Gráfico — quantidade no período"
          icon={Activity}
          iconClassName="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"
          items={porStatusData?.items ?? []}
          distributionTotal={porStatusData?.total}
          loading={isLoadingPorStatus}
          suppressChartConsolidadoZero={suprimirGraficosPeloConsolidado}
        />
        <ReportDistributionPieCard
          title="Distribuição por método"
          subtitle="Gráfico — quantidade no período"
          icon={CreditCard}
          iconClassName="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
          items={porMetodoData?.items ?? []}
          distributionTotal={porMetodoData?.total}
          loading={isLoadingPorMetodo}
          suppressChartConsolidadoZero={suprimirGraficosPeloConsolidado}
        /> */}
        <LucroSimpayPlataformaBarCard
          title="Lucro Simintpay por plataforma"
          subtitle={`Período filtrado (${ymdInicioGrafico} a ${ymdFimGrafico}) · mesma base do consolidado.`}
          detalhe={lucroDetalheGrafico}
          ymdStart={ymdInicioGrafico}
          ymdEnd={ymdFimGrafico}
          loading={carregandoDistribuicao || loadingLucroPlataformaChart}
          hasTransactionsInPeriod={temTransacoesNoPeriodo}
        />
        {/* <TransactionDistributionCard
          title="Transações por Status"
          subtitle="Distribuição por Status"
          icon={Activity}
          iconClassName="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"
          items={porStatusData?.items ?? []}
          loading={isLoadingPorStatus}
        /> */}
        {/* <TransactionDistributionCard
          title="Transações por Método"
          subtitle="Distribuição por Método de Pagamento"
          icon={CreditCard}
          iconClassName="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
          items={porMetodoData?.items ?? []}
          loading={isLoadingPorMetodo}
        /> */}
      </div>

      {mensalError ? (
        <ReportError retry={() => void retryMensal()} />
      ) : (
        <ReportResultsTable
          title="Resultados mensais"
          label="Mês"
          monthly
          admin
          loading={isLoadingMensal}
          rows={(mensalData?.meses ?? []).map((row) => ({
            key: row.mes,
            label: row.mes,
            count: row.vendas,
            gross: row.valorBruto,
            acquirerFees: row.taxaAdquirente,
            net: row.totalRepassado,
            profit: row.lucroLiquido,
          }))}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <OwnedReportSeries
          filters={{
            startDate: formatQueryDate(range.start) ?? undefined,
            endDate: formatQueryDate(range.end) ?? undefined,
            paymentMethod: method === 'all' ? undefined : method,
          }}
          kind="metodos"
          admin
        />
        <OwnedReportSeries
          filters={{
            startDate: formatQueryDate(range.start) ?? undefined,
            endDate: formatQueryDate(range.end) ?? undefined,
            paymentMethod: method === 'all' ? undefined : method,
          }}
          kind="status"
          admin
        />
      </div>
    </TooltipRadix.Provider>
  );
}
