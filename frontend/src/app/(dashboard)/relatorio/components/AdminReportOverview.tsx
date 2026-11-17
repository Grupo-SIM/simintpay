'use client';

import { useMemo } from 'react';
import {
  TrendingUp,
  Wallet,
  ArrowUpRight,
  Percent,
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
import type { ReportPlatform } from './report-types';
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
  margemTaxa:
    'Margem percentual e por transação aplicadas pela Sim Int Pay, sem juros de parcelamento.',
  margemParcelamento:
    'Margem dos juros de parcelamento que fica na Sim Int Pay.',
  margemSaque: 'Taxa de saque cobrada pela Sim Int Pay.',
  totalMargem:
    'Receita Sim Int Pay. Menos as taxas de adquirentes, resulta no lucro líquido.',
  parcelamentoAdq: 'Juros de parcelamento cobrados pela adquirente.',
  totalAdquirente: 'Soma dos custos desta adquirente.',
  taxasAdquirentes: 'Soma dos custos de todas as adquirentes.',
  valorLiquido: 'Líquido total das transações.',
  lucroLiquido: 'Margem de taxas + taxas de saque - custos de saque.',
  roi: 'Lucro líquido ÷ receita total.',
  totalRepasse: 'Líquido das vendas destinado aos clientes.',
  saquesPendentes: 'Saques aguardando aprovação.',
  lucroSaque: 'Arrecadado com taxas de saque.',
  taxaSaqueDOM: 'Custo DOM por saque: R$ 3,50 cada.',
  estornos: 'Estornos. Ícone alterna quantidade/valor.',
  quantidadeClientes:
    'Compradores únicos por CPF nas vendas aprovadas do período. Compras sem CPF não entram na contagem.',
  // ── Bloco DOM ──
  taxaBaseAdq:
    'Taxa base da adquirente: percentual (MDR) mais taxa fixa por transação.',
  taxaCashbackDom: 'R$ 3 por transação de cashback DOM.',
  // ── Bloco Sim Int Pay ──
  taxaSimIntPct: 'Margem percentual da Sim Int Pay, já sem o MDR DOM.',
  taxaServicoDom: 'R$ 4 por transação cobrados pela Sim Int Pay.',
  totalTaxasSimInt: 'Receita Sim Int Pay: margem % + taxa por transação.',
} as const;

type ConsolidadoResponse = {
  valorBruto?: number;
  lucroTotalMaster?: number;
  totalTransacoes?: number;
  totalRepasseConsolidado?: number;
  customersCount?: number;
  taxaSaqueDOM?: number;
  saquesAprovados?: { valor?: number; quantidade?: number };
  adquirentes?: Array<{
    adquirente: string;
    transacoes: number;
    taxaPercentual: number;
    taxaPorTransacao: number;
    cashback: number;
    parcelamento: number;
    taxaSaque: number;
  }>;
  margemSimIntPay?: {
    taxaPercentual: number;
    parcelamento: number;
    taxaSaque: number;
  };
  naoIdentificadas?: { valor?: number; quantidade?: number };
};

export default function AdminReportOverview({
  range,
  method = 'all',
  platform,
}: {
  range: DateRange;
  method?: string;
  platform?: ReportPlatform;
}) {
  const platformScoped = !!platform;
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
      platform?.tag,
    ],
    queryFn: async () => {
      return api.get<ConsolidadoResponse>(endpoints.relatorios.consolidado, {
        query: {
          metodoPagamento: method === 'all' ? undefined : method,
          periodType: DEFAULT_PERIOD_TYPE,
          dataInicio: formatQueryDate(effectiveDateRange.start) ?? undefined,
          dataFim: formatQueryDate(effectiveDateRange.end) ?? undefined,
          transactionType: DEFAULT_TRANSACTION_TYPE,
          plataforma: platform?.tag,
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
        platform?.tag,
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
            plataforma: platform?.tag,
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
      enabled: !platformScoped,
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

  const adquirentes = consolidado?.adquirentes ?? [];
  const margem = consolidado?.margemSimIntPay ?? {
    taxaPercentual: 0,
    parcelamento: 0,
    taxaSaque: 0,
  };
  const totalMargem =
    Math.round(
      (margem.taxaPercentual + margem.parcelamento + margem.taxaSaque) * 100,
    ) / 100;
  /** Soma dos custos de todas as adquirentes; mesma base do lucro líquido. */
  const totalTaxasAdquirentes =
    Math.round(
      adquirentes.reduce(
        (s, a) =>
          s +
          a.taxaPercentual +
          a.taxaPorTransacao +
          a.cashback +
          a.parcelamento +
          a.taxaSaque,
        0,
      ) * 100,
    ) / 100;

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
            label="Taxas de adquirentes"
            tooltip={METRIC_TT.taxasAdquirentes}
            value={
              isLoadingConsolidado
                ? 'Carregando...'
                : formatBRL(totalTaxasAdquirentes)
            }
            valueClassName="text-rose-600 dark:text-rose-400"
            icon={Building2}
            iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
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
          <MetricCard
            label="Margem de Lucro Líquido"
            tooltip={METRIC_TT.roi}
            value={roiFormatado}
            valueClassName="text-purple-600 dark:text-purple-400"
            icon={Target}
            iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
          />
        </ReportMetricSection>

        {/* ── Taxas Sim Int Pay: somente a margem aplicada ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Lucro SimIntPay
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {[
              ['Taxa', margem.taxaPercentual, Percent, METRIC_TT.margemTaxa],
              [
                'Parcelamento',
                margem.parcelamento,
                CreditCard,
                METRIC_TT.margemParcelamento,
              ],
              ...(platformScoped
                ? []
                : [['Saque', margem.taxaSaque, Wallet, METRIC_TT.margemSaque]]),
              ['Total', totalMargem, Wallet, METRIC_TT.totalMargem],
            ].map(([label, value, Icon, tooltip]) => (
              <MetricCard
                key={label as string}
                label={label as string}
                tooltip={tooltip as string}
                value={
                  isLoadingConsolidado
                    ? 'Carregando...'
                    : formatBRL(value as number)
                }
                valueClassName="text-violet-600 dark:text-violet-400"
                icon={Icon as typeof Percent}
                iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
              />
            ))}
          </div>
        </section>

        {/* ── Taxas de adquirentes: uma seção por adquirente com transação no período ── */}
        {adquirentes.map((a) => {
          const total =
            a.taxaPercentual +
            a.taxaPorTransacao +
            a.cashback +
            a.parcelamento +
            a.taxaSaque;
          const isDom = a.adquirente === 'DOM';
          const itens: [string, number, typeof Percent, string][] = [
            [
              'Taxa',
              a.taxaPercentual + a.taxaPorTransacao,
              Percent,
              METRIC_TT.taxaBaseAdq,
            ],
            [
              'Parcelamento',
              a.parcelamento,
              CreditCard,
              METRIC_TT.parcelamentoAdq,
            ],
            ...(platformScoped
              ? ([] as [string, number, typeof Percent, string][])
              : ([['Saque', a.taxaSaque, Banknote, METRIC_TT.taxaSaqueDOM]] as [
                  string,
                  number,
                  typeof Percent,
                  string,
                ][])),
            ...(isDom
              ? ([
                  ['Cashback', a.cashback, Gift, METRIC_TT.taxaCashbackDom],
                ] as [string, number, typeof Percent, string][])
              : []),
            ['Total', total, Building2, METRIC_TT.totalAdquirente],
          ];
          return (
            <section key={a.adquirente} className="flex flex-col gap-3">
              <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Taxas de adquirentes — {a.adquirente}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {itens.map(([label, value, Icon, tooltip]) => (
                  <MetricCard
                    key={label}
                    label={label}
                    tooltip={tooltip}
                    value={
                      isLoadingConsolidado ? 'Carregando...' : formatBRL(value)
                    }
                    valueClassName="text-rose-600 dark:text-rose-400"
                    icon={Icon}
                    iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
                  />
                ))}
              </div>
            </section>
          );
        })}

        <AdminReportMovements
          boletos={
            boletoResumo && boletoResumo.quantidade > 0 ? (
              <MetricCard
                label="Boletos"
                value={formatBRL(boletoResumo.valorBruto)}
                detail={`${boletoResumo.quantidade.toLocaleString('pt-BR')} ${boletoResumo.quantidade === 1 ? 'boleto' : 'boletos'}`}
                valueClassName="text-sky-600 dark:text-sky-400"
                icon={Receipt}
                iconClassName="text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400"
              />
            ) : undefined
          }
          extra={
            platformScoped ? undefined : (
              <>
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
                  value={
                    isLoadingConsolidado
                      ? 'Carregando...'
                      : formatBRL(consolidado?.saquesAprovados?.valor)
                  }
                  detail={`${consolidado?.saquesAprovados?.quantidade ?? 0} ${consolidado?.saquesAprovados?.quantidade === 1 ? 'saque' : 'saques'}`}
                  valueClassName="text-amber-500"
                  icon={ArrowUpRight}
                  iconClassName="text-amber-500 bg-amber-50 dark:bg-amber-950/30"
                />
              </>
            )
          }
          filters={{
            platform: platform?.tag,
            startDate: formatQueryDate(range.start) ?? undefined,
            endDate: formatQueryDate(range.end) ?? undefined,
            paymentMethod: method === 'all' ? undefined : method,
          }}
        />

        {(consolidado?.naoIdentificadas?.quantidade ?? 0) > 0 && (
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
        )}
      </div>

      {!platformScoped && (
        <>
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
        </>
      )}
    </TooltipRadix.Provider>
  );
}
