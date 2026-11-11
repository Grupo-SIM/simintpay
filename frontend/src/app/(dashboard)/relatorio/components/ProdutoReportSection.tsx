'use client';

import { useState, useMemo, useCallback } from 'react';
import { useReportQuery as useQuery } from '@/hooks/use-report-api';
import { useTheme } from 'next-themes';
import {
  Building2,
  Tv,
  Wallet,
  CreditCard,
  Smartphone,
  ArrowDownToLine,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Percent,
  DollarSign,
  Package,
  Search,
  Eraser,
  QrCode,
  Users,
  Banknote,
  Clock,
  Landmark,
  Hash,
  ChartPie,
  RefreshCw,
  AlertTriangle,
  Eye,
  X,
  Barcode,
} from 'lucide-react';
import { Tooltip as TooltipRadix } from 'radix-ui';
import { Pie, PieChart, Cell } from 'recharts';
import { Spinner } from '@/components/ui/Loading';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { MoneyCell } from '@/components/ui/MoneyCell';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { formatTransacaoDescricaoUi } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/use-current-user';
import { isMasterAdminClient } from '@/lib/is-master-admin-client';
import {
  consolidadoTagFor,
  findPlataformaDetalheByTag,
} from '@/lib/consolidado-tag';
import { MetricCard } from './MetricCard';
import { ActionButton } from './ActionButton';
import { DateRangePickerField } from './DateRangePickerField';
import type { DateRange } from '../types';
import type { Plataforma as PlataformaDetalhe } from './LucroSimpayDetalhePanel';
import { PlatformBalancesView } from './PlatformBalancesView';
import { ReportPlatformSelect } from './ReportPlatformSelect';
import { ReportSkeleton } from './ReportSkeleton';
import { ReportError } from './ReportError';
import { OwnedReportContent } from './OwnedReportContent';
import type { ReportPlatform } from './report-types';

// ─── Produto config ────────────────────────────────────────────────────────────

type ReportTransaction = {
  id: string;
  descricao?: string | null;
  cliente?: { nome?: string; documento?: string };
  metodoPagamento?: string;
  status: string;
  valorBruto: number;
  taxaDom?: number;
  taxaCashback?: number;
  taxaFixa?: number;
  taxaSimIntPay?: number;
  taxaServico?: number;
  lucroPrejuizo?: number;
  criadoEm: string;
  clienteNome?: string;
  valorLiquido?: number;
};
type TransactionPage = {
  data: ReportTransaction[];
  page: number;
  pageSize: number;
  total: number;
};
type DashboardStats = {
  saqueFees?: { quantidade?: number; lucroSimpay?: number };
  estornos?: { valorLiquido?: number; quantidade?: number };
  chargebacks?: { valorLiquido?: number; quantidade?: number };
};
type ConsolidadoProduto = {
  lucroSimpayDetalhe?: { plataformas?: PlataformaDetalhe[] };
  data?: { lucroSimpayDetalhe?: { plataformas?: PlataformaDetalhe[] } };
};
type ProdutoSubscriber = {
  lastPaymentMethod?: string | null;
  frozenDays?: number | null;
  cpf?: string | null;
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  isActive: boolean;
  expiresAt?: string;
  createdAt?: string;
  remainingDays?: number;
};
type SubscriberPage = {
  users: ProdutoSubscriber[];
  total: number;
  totalPages: number;
};

type ProdutoConfig = {
  tag: string;
  label: string;
  icon: 'building' | 'tv';
  tab: { active: string; inactive: string };
  accent: string;
};

const PRODUTOS_BASE: ProdutoConfig[] = [
  {
    tag: 'PAGATG',
    label: 'PagaTG',
    icon: 'building',
    tab: {
      active: 'bg-violet-600 text-white border-violet-600',
      inactive:
        'text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-500/30 hover:bg-violet-50 dark:hover:bg-violet-500/10',
    },
    accent: '#7c3aed',
  },
  {
    tag: 'RENOVADA',
    label: 'Renovada',
    icon: 'building',
    tab: {
      active: 'bg-amber-500 text-white border-amber-500',
      inactive:
        'text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30 hover:bg-amber-50 dark:hover:bg-amber-500/10',
    },
    accent: '#d97706',
  },
  {
    tag: 'BOSQUE',
    label: 'Bosque',
    icon: 'building',
    tab: {
      active: 'bg-emerald-600 text-white border-emerald-600',
      inactive:
        'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
    },
    accent: '#059669',
  },
  {
    tag: 'AREAFLIX',
    label: 'Áreaflix',
    icon: 'tv',
    tab: {
      active: 'bg-sky-600 text-white border-sky-600',
      inactive:
        'text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/30 hover:bg-sky-50 dark:hover:bg-sky-500/10',
    },
    accent: '#0284c7',
  },
  {
    tag: 'EBOOKSIM',
    label: 'EbookSim',
    icon: 'building',
    tab: {
      active: 'bg-cyan-600 text-white border-cyan-600',
      inactive:
        'text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-500/30 hover:bg-cyan-50 dark:hover:bg-cyan-500/10',
    },
    accent: '#0891b2',
  },
  {
    tag: 'ATLAS',
    label: 'AtlasHosting',
    icon: 'building',
    tab: {
      active: 'bg-orange-600 text-white border-orange-600',
      inactive:
        'text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/30 hover:bg-orange-50 dark:hover:bg-orange-500/10',
    },
    accent: '#ea580c',
  },
  {
    tag: 'REVALIDA',
    label: 'Revalida',
    icon: 'building',
    tab: {
      active: 'bg-rose-600 text-white border-rose-600',
      inactive:
        'text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10',
    },
    accent: '#e11d48',
  },
  {
    tag: 'ZERO_GRAU',
    label: 'Zero Grau',
    icon: 'building',
    tab: {
      active: 'bg-sky-600 text-white border-sky-600',
      inactive:
        'text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/30 hover:bg-sky-50 dark:hover:bg-sky-500/10',
    },
    accent: '#0284c7',
  },
];

// ─── Utils ─────────────────────────────────────────────────────────────────────

function formatBRL(v: number | undefined | null) {
  return (v ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatPercent(v: number | undefined | null) {
  return `${(Number(v ?? 0) * 100).toFixed(2)}%`;
}

function formatDateTime(value: string | null | undefined) {
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

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('pt-BR');
}

function formatDocument(doc: string | null | undefined) {
  if (!doc) return '-';
  const d = doc.replace(/\D/g, '');
  if (d.length === 11)
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14)
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

function mapStatusLabel(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase();
  if (s === 'COMPLETED' || s === 'APPROVED') return 'Aprovado';
  if (s === 'PENDING' || s === 'DRAFT') return 'Pendente';
  if (s === 'FAILED' || s === 'REJECTED') return 'Recusado';
  if (s === 'REFUNDED') return 'Estornado';
  if (s === 'EXPIRED') return 'Expirado';
  return status ?? '-';
}

function mapAreaflixStatus(status: string | null | undefined) {
  const s = (status ?? '').toLowerCase();
  if (s === 'paid' || s === 'active' || s === 'approved') return 'Aprovado';
  if (s === 'pending') return 'Pendente';
  if (s === 'expired') return 'Expirado';
  if (s === 'cancelled' || s === 'canceled' || s === 'inactive')
    return 'Cancelado';
  return status ?? '-';
}

function calcExpiresAt(
  createdAt: string,
  frequencyType: string | null | undefined,
): Date | null {
  const base = new Date(createdAt);
  if (Number.isNaN(base.getTime())) return null;
  const ft = (frequencyType ?? 'MENSAL').toUpperCase();
  if (ft === 'ANUAL') base.setFullYear(base.getFullYear() + 1);
  else if (ft === 'SEMESTRAL') base.setMonth(base.getMonth() + 6);
  else if (ft === 'TRIMESTRAL') base.setMonth(base.getMonth() + 3);
  else base.setMonth(base.getMonth() + 1);
  return base;
}

function daysRemaining(exp: Date | null) {
  if (!exp) return 0;
  return Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000));
}

function isPaidStatus(status: string | null | undefined) {
  return ['paid', 'active', 'approved'].includes((status ?? '').toLowerCase());
}

/**
 * Período padrão quando nenhuma data é informada: 1º dia do mês corrente até hoje.
 *
 * Sem isso, o painel consultava dois endpoints com janelas diferentes — `consolidado`
 * (Receita Total) sem filtro nenhum (histórico inteiro) e `plataforma-consolidado`
 * (Repasse e taxas) já com o default de início do mês do backend. Os cards derivados
 * (ex.: "Taxa Percentual - Sim Int Pay" = Receita − Repasse) misturavam as duas janelas
 * e mostravam valores absurdos. Enviando um período explícito, as duas chamadas ficam
 * sempre no mesmo intervalo.
 */
function currentMonthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function currentMonthEnd(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function formatQueryDate(d: Date | null | undefined) {
  if (!d) return undefined;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Atlas panel ───────────────────────────────────────────────────────────────

type AtlasBreakdown = {
  clientesUnicos: number;
  dominios: {
    receita: number;
    lucro: number;
    quantidade: number;
    distribuicaoMetodo: {
      codigo: string;
      nome: string;
      quantidade: number;
      valor: number;
      percentual: number;
    }[];
  };
  hospedagem: {
    receita: number;
    lucro: number;
    quantidade: number;
    distribuicaoMetodo: {
      codigo: string;
      nome: string;
      quantidade: number;
      valor: number;
      percentual: number;
    }[];
    porProduto: {
      nome: string;
      receita: number;
      lucro: number;
      quantidade: number;
    }[];
  };
  outros: {
    receita: number;
    lucro: number;
    quantidade: number;
    distribuicaoMetodo: {
      codigo: string;
      nome: string;
      quantidade: number;
      valor: number;
      percentual: number;
    }[];
  };
};

function AtlasPieChart({
  items,
  isLoading,
}: {
  items: {
    codigo: string;
    nome: string;
    quantidade: number;
    valor: number;
    percentual: number;
  }[];
  isLoading: boolean;
}) {
  const chartData = useMemo(() => {
    const COLORS: Record<string, string> = {
      PIX: '#10b981',
      CREDIT_CARD: '#6366f1',
      DEBIT_CARD: '#f59e0b',
    };
    const config: ChartConfig = {};
    const data = items.map((item, i) => {
      const key = item.codigo.replace(/[^a-zA-Z0-9_-]/g, '_') || `slice_${i}`;
      config[key] = {
        label: item.nome,
        color: COLORS[item.codigo] ?? `hsl(${i * 100} 60% 50%)`,
      };
      return {
        chartKey: key,
        nome: item.nome,
        quantidade: item.quantidade,
        valor: item.valor,
        percentual: item.percentual,
        fill: `var(--color-${key})`,
      };
    });
    return { data, config };
  }, [items]);

  if (isLoading)
    return (
      <div className="flex h-[200px] w-full max-w-[220px] animate-pulse items-center justify-center rounded-full bg-zinc-200/50 dark:bg-white/10" />
    );
  if (chartData.data.length === 0)
    return (
      <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Sem transações no período.
      </p>
    );

  return (
    <ChartContainer
      config={chartData.config}
      className="mx-auto aspect-square h-[min(200px,80vw)] w-full max-w-[200px]"
    >
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              nameKey="chartKey"
              hideLabel
              formatter={(value, _name, item) => {
                const p = item?.payload as
                  | { nome?: string; percentual?: number; valor?: number }
                  | undefined;
                return (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground">
                      {p?.nome ?? '—'}
                    </span>
                    <span className="font-mono font-medium tabular-nums">
                      {Number(value).toLocaleString('pt-BR')} (
                      {Number(p?.percentual ?? 0).toFixed(1)}%)
                    </span>
                    <span className="text-xs text-zinc-400">
                      {formatBRL(p?.valor)}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Pie
          data={chartData.data}
          dataKey="quantidade"
          nameKey="chartKey"
          innerRadius={40}
          strokeWidth={2}
          className="stroke-background"
          isAnimationActive={false}
        >
          {chartData.data.map((entry) => (
            <Cell key={entry.chartKey} fill={entry.fill} />
          ))}
        </Pie>
        <ChartLegend
          content={
            <ChartLegendContent
              nameKey="chartKey"
              className="flex-wrap gap-x-3 gap-y-1"
            />
          }
          className="-translate-y-2"
        />
      </PieChart>
    </ChartContainer>
  );
}

function AtlasPanel({
  dashDataInicio,
  dashDataFim,
}: {
  dashDataInicio?: string;
  dashDataFim?: string;
}) {
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [panelDateRange, setPanelDateRange] = useState<DateRange>({
    start: dashDataInicio ? new Date(`${dashDataInicio}T00:00:00`) : null,
    end: dashDataFim ? new Date(`${dashDataFim}T23:59:59`) : null,
  });
  const [appliedPanelStart, setAppliedPanelStart] = useState(dashDataInicio);
  const [appliedPanelEnd, setAppliedPanelEnd] = useState(dashDataFim);
  const handleAplicarPeriodo = useCallback(() => {
    setAppliedPanelStart(formatQueryDate(panelDateRange.start));
    setAppliedPanelEnd(formatQueryDate(panelDateRange.end));
  }, [panelDateRange]);
  const periodoInicio = appliedPanelStart;
  const periodoFim = appliedPanelEnd;
  const [showAtlasModal, setShowAtlasModal] = useState(false);
  const [atlasModalPage, setAtlasModalPage] = useState(1);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      }),
    [],
  );

  type AtlasSeller = {
    name: string;
    email: string;
    cpf: string;
    balance: number | null;
    lockedBalance: number | null;
    balanceStatus?: 'complete' | 'unavailable';
    createdAt: string;
  };
  const { data: atlasModalData, isLoading: isLoadingAtlasModal } = useQuery({
    queryKey: ['atlas-sellers-ativos', atlasModalPage],
    enabled: true,
    staleTime: 2 * 60_000,
    queryFn: () =>
      api.get<{
        data: AtlasSeller[];
        total: number;
        page: number;
        pageSize: number;
      }>(endpoints.internalStats.sellersAtivos('atlas'), {
        query: { page: String(atlasModalPage), pageSize: '20' },
      }),
  });

  const { data: consolidadoProduto, isLoading: isLoadingConsolidado } =
    useQuery({
      queryKey: ['atlas-consolidado', periodoInicio, periodoFim],
      queryFn: () =>
        api.get<ConsolidadoProduto>(endpoints.relatorios.consolidado, {
          query: {
            periodType: 'settlement',
            transactionType: 'all',
            detalharLucro: '1',
            dataInicio: periodoInicio,
            dataFim: periodoFim,
          },
        }),
    });

  const { data: breakdown, isLoading: isLoadingBreakdown } = useQuery({
    queryKey: ['atlas-breakdown', periodoInicio, periodoFim],
    queryFn: () =>
      api.get<AtlasBreakdown>(endpoints.admin.plataformas.atlasBreakdown, {
        query: { dataInicio: periodoInicio, dataFim: periodoFim },
      }),
  });

  const { data: dashStats, isLoading: isLoadingDash } = useQuery({
    queryKey: ['atlas-dashboard', periodoInicio, periodoFim],
    queryFn: () =>
      api.get<DashboardStats>(endpoints.admin.plataformas.dashboard('atlas'), {
        query: { dataInicio: periodoInicio, dataFim: periodoFim },
      }),
  });

  const { data: atlasConsolidado, isLoading: isLoadingAtlas } = useQuery({
    queryKey: ['atlasConsolidado', periodoInicio, periodoFim],
    queryFn: async () => {
      return api.get<{
        taxaDomPct: number;
        taxaDomFixa: number;
        taxaDomCashback: number;
        totalTaxasDom: number;
        taxaSimIntPctBruta: number;
        taxaSimIntPctNet: number;
        taxaSimIntFixa: number;
        totalTaxasSimInt: number;
        totalRepasse?: number;
        taxaParcelamentoBruto: number;
        taxaParcelamentoSimIntPay: number;
        taxaSimInt: number;
        taxaAdquirente: number;
        custoCashback: number;
        custoDominio: number;
        custoHospedagem: number;
        receitaLiquidaSimintpay: number;
        lucroLiquidoDominio: number;
        lucroLiquidoVps: number;
        lucroAfiliado: number;
        totalRepasseAfiliado: number;
        lucroSimpayDeSaque: number;
        receitaLiquidaAtlas: number;
        saquePendente: number;
        roiSimintpay: number;
        roiDominios: number;
        roiHospedagem: number;
        roiAtlas: number;
        estornoCount: number;
        chargebackCount: number;
        receitaTotalAtlas: number;
        qtdTransacoes: number;
        atlasApiAvailable: boolean;
      }>(endpoints.relatorios.atlasConsolidado, {
        query: {
          startDate: periodoInicio ?? undefined,
          endDate: periodoFim ?? undefined,
        },
      });
    },
  });

  // Transaction filters
  const [txDateRange, setTxDateRange] = useState<DateRange>({
    start: null,
    end: null,
  });
  const [status, setStatus] = useState('');
  const [codigoTransacao, setCodigoTransacao] = useState('');
  const [codigoReferencia, setCodigoReferencia] = useState('');
  const [compradorNome, setCompradorNome] = useState('');
  const [compradorDocumento, setCompradorDocumento] = useState('');
  const [compradorEmail, setCompradorEmail] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>({
    periodType: 'sale',
  });
  const [txPage, setTxPage] = useState(1);

  const {
    data: txResponse,
    isLoading: isLoadingTxs,
    isFetching: isFetchingTxs,
  } = useQuery({
    queryKey: ['atlas-transacoes', txPage, appliedFilters],
    queryFn: () =>
      api.get<TransactionPage>(
        endpoints.admin.plataformas.transacoes('atlas'),
        {
          query: { page: txPage, pageSize: PAGE_SIZE, ...appliedFilters },
        },
      ),
  });

  const handleSearch = useCallback(() => {
    setTxPage(1);
    setAppliedFilters({
      periodType: 'sale',
      dataInicio: formatQueryDate(txDateRange.start),
      dataFim: formatQueryDate(txDateRange.end),
      status: status || undefined,
      codigoTransacao: codigoTransacao || undefined,
      codigoReferencia: codigoReferencia || undefined,
      compradorNome: compradorNome || undefined,
      compradorDocumento: compradorDocumento || undefined,
      compradorEmail: compradorEmail || undefined,
    });
  }, [
    txDateRange,
    status,
    codigoTransacao,
    codigoReferencia,
    compradorNome,
    compradorDocumento,
    compradorEmail,
  ]);

  const handleClear = useCallback(() => {
    setTxDateRange({ start: null, end: null });
    setStatus('');
    setCodigoTransacao('');
    setCodigoReferencia('');
    setCompradorNome('');
    setCompradorDocumento('');
    setCompradorEmail('');
    setTxPage(1);
    setAppliedFilters({ periodType: 'sale' });
  }, []);

  const txColumns = useMemo(
    () => [
      {
        key: 'id',
        header: 'ID',
        render: (row: ReportTransaction) => (
          <span className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
            {row.id.slice(0, 8)}...
          </span>
        ),
      },
      {
        key: 'descricao',
        header: 'Descrição',
        className: 'text-left',
        headerClassName: 'text-left',
        render: (row: ReportTransaction) => (
          <span className="truncate text-sm text-zinc-900 dark:text-zinc-100">
            {formatTransacaoDescricaoUi(row.descricao) || '-'}
          </span>
        ),
      },
      {
        key: 'cliente',
        header: 'Cliente',
        className: 'text-left',
        headerClassName: 'text-left',
        render: (row: ReportTransaction) => (
          <div className="flex flex-col">
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {row.cliente?.nome ?? '-'}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatDocument(row.cliente?.documento)}
            </span>
          </div>
        ),
      },
      {
        key: 'metodoPagamento',
        header: 'Método',
        render: (row: ReportTransaction) => {
          const m = String(row.metodoPagamento ?? '').toUpperCase();
          const isPix = m === 'PIX';
          const isBoleto = m === 'BOLETO';
          return (
            <div className="flex items-center justify-center gap-2">
              {isPix ? (
                <QrCode className="h-4 w-4 text-emerald-700" />
              ) : isBoleto ? (
                <Barcode className="h-4 w-4 text-zinc-700 dark:text-zinc-400" />
              ) : (
                <CreditCard className="h-4 w-4 text-zinc-700 dark:text-zinc-400" />
              )}
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {isPix ? 'Pix' : isBoleto ? 'Boleto' : 'Cartão'}
              </span>
            </div>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (row: ReportTransaction) => (
          <Badge value={row.status}>{mapStatusLabel(row.status)}</Badge>
        ),
      },
      {
        key: 'valorBruto',
        header: 'Valor Bruto',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => {
          const desc = String(row.descricao ?? '').toUpperCase();
          const isDomain = !desc.includes('VPS') && !desc.includes('VDS');
          const display = isDomain
            ? Number(row.valorBruto) - 4
            : Number(row.valorBruto);
          return (
            <MoneyCell
              value={display}
              className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
            />
          );
        },
      },
      {
        key: 'taxaDom',
        header: 'Taxa - DOM (%)',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaDom}
            className="text-sm font-medium text-red-500 dark:text-red-400"
          />
        ),
      },
      {
        key: 'taxaCashback',
        header: 'Cashback - DOM',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaCashback}
            className="text-sm font-medium text-red-500 dark:text-red-400"
          />
        ),
      },
      {
        key: 'taxaFixa',
        header: 'Taxa Transação - DOM',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaFixa}
            className="text-sm font-medium text-red-500 dark:text-red-400"
          />
        ),
      },
      {
        key: 'totalTaxasDom',
        header: 'Total Taxas - DOM',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => {
          const v =
            Number(row.taxaDom ?? 0) +
            Number(row.taxaFixa ?? 0) +
            Number(row.taxaCashback ?? 0);
          return (
            <MoneyCell
              value={v}
              className="text-sm font-semibold text-red-600 dark:text-red-400"
            />
          );
        },
      },
      {
        key: 'taxaSimIntPay',
        header: 'Taxa - Sim Int Pay (%)',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaSimIntPay}
            className="text-sm font-medium text-emerald-500 dark:text-emerald-400"
          />
        ),
      },
      {
        key: 'taxaServico',
        header: 'Taxa Transação - Sim Int Pay',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaServico}
            className="text-sm font-medium text-emerald-500 dark:text-emerald-400"
          />
        ),
      },
      {
        key: 'totalTaxasSimInt',
        header: 'Total Taxas - Sim Int Pay',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => {
          const v =
            Number(row.taxaSimIntPay ?? 0) + Number(row.taxaServico ?? 0);
          return (
            <MoneyCell
              value={v}
              className="text-sm font-semibold text-emerald-600 dark:text-emerald-400"
            />
          );
        },
      },
      {
        key: 'lucroPrejuizo',
        header: 'Lucro',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => {
          const v = Number(row.lucroPrejuizo ?? 0);
          return (
            <MoneyCell
              value={v}
              className={`font-medium tabular-nums ${v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
            />
          );
        },
      },
      {
        key: 'criadoEm',
        header: 'Data da Venda',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatDateTime(row.criadoEm)}
          </span>
        ),
      },
    ],
    [],
  );

  const plataformaDetalhe = useMemo((): PlataformaDetalhe | null => {
    if (!consolidadoProduto) return null;
    const root = consolidadoProduto?.data ?? consolidadoProduto;
    const rawDetalhe = root?.lucroSimpayDetalhe;
    if (!rawDetalhe || typeof rawDetalhe !== 'object') return null;
    const detalhe = rawDetalhe as { plataformas?: PlataformaDetalhe[] };
    return (
      detalhe.plataformas?.find((p) => p.tag.toUpperCase() === 'ATLAS') ?? null
    );
  }, [consolidadoProduto]);

  const isLoading = isLoadingConsolidado || isLoadingBreakdown;
  const fmt = formatBRL;

  return (
    <div className="flex flex-col gap-8">
      {/* ── Período do produto ── */}
      <section>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Período do produto
        </p>
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/2">
          <div className="flex-1 min-w-[260px]">
            <DateRangePickerField
              label="Data inicial e final:"
              value={panelDateRange}
              onChange={setPanelDateRange}
              theme={fieldTheme}
            />
          </div>
          <ActionButton variant="primary" onClick={handleAplicarPeriodo}>
            <Search className="h-4 w-4" />
            Aplicar
          </ActionButton>
        </div>
        {(periodoInicio || periodoFim) && (
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
            Período aplicado: {formatDateBR(periodoInicio)} a{' '}
            {formatDateBR(periodoFim)}
          </p>
        )}
      </section>

      {/* Relatório Detalhado SimIntPay */}
      <div className="mt-8">
        <h2 className="text-base font-semibold mb-4 text-orange-600 dark:text-orange-400">
          Relatório Detalhado SimIntPay
        </h2>
        {atlasConsolidado?.atlasApiAvailable === false && (
          <div className="mb-4 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400">
            Dados do Atlas indisponíveis no momento. Os valores abaixo podem
            estar incompletos.
          </div>
        )}
        <TooltipRadix.Provider delayDuration={200}>
          <div className="flex flex-col gap-8">
            {/* ── Visão Geral (mesmos cards do painel genérico) ── */}
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Visão Geral
              </h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                <MetricCard
                  label="Receita Total"
                  tooltip="Valor bruto das vendas aprovadas do Atlas."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.receitaTotalAtlas ?? 0)
                  }
                  valueClassName="text-emerald-600 dark:text-emerald-400"
                  icon={TrendingUp}
                  iconClassName="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400"
                />
                <MetricCard
                  label="Total de Repasse"
                  tooltip="Soma do líquido de cada transação."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(
                          atlasConsolidado?.totalRepasse ??
                            (atlasConsolidado?.receitaTotalAtlas ?? 0) -
                              (atlasConsolidado?.totalTaxasSimInt ?? 0),
                        )
                  }
                  valueClassName="text-cyan-600 dark:text-cyan-400"
                  icon={Banknote}
                  iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                />
              </div>
            </section>

            {/* ── Taxas Sim Int Pay ── */}
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Taxas Sim Int Pay
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                <MetricCard
                  label="Receita Líquida - Sim Int Pay"
                  tooltip="Receita líquida da Sim Int Pay: o que sobra depois de pagar todos os custos da DOM (MDR percentual + R$ 1 por transação + R$ 3 de cashback)."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.taxaSimIntPctNet ?? 0)
                  }
                  icon={TrendingUp}
                  iconClassName="text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400"
                  valueClassName="text-orange-600 dark:text-orange-400"
                />
                <MetricCard
                  label="Taxa por Transação - Sim Int Pay"
                  tooltip="R$ 4 por transação cobrados pela Sim Int Pay."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.taxaSimIntFixa ?? 0)
                  }
                  icon={TrendingUp}
                  iconClassName="text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400"
                  valueClassName="text-orange-600 dark:text-orange-400"
                />
                <MetricCard
                  label="Total de Taxas - Sim Int Pay"
                  tooltip="Receita Sim Int Pay: margem % + taxa por transação."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.totalTaxasSimInt ?? 0)
                  }
                  icon={TrendingUp}
                  iconClassName="text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400"
                  valueClassName="text-orange-600 dark:text-orange-400"
                />
              </div>
            </section>

            {/* ── Taxas DOM & Parcelamento ── */}
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Taxas DOM &amp; Parcelamento
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                <MetricCard
                  label="Taxa Percentual - DOM"
                  tooltip="MDR percentual da DOM (varia por método e parcela)."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.taxaDomPct ?? 0)
                  }
                  icon={TrendingDown}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
                <MetricCard
                  label="Taxa por Transação - DOM"
                  tooltip="R$ 1 por transação cobrado pela DOM."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.taxaDomFixa ?? 0)
                  }
                  icon={TrendingDown}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
                <MetricCard
                  label="Taxa Cashback - DOM"
                  tooltip="R$ 3 por transação de cashback DOM."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.taxaDomCashback ?? 0)
                  }
                  icon={TrendingDown}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
                <MetricCard
                  label="Total de Taxas - DOM"
                  tooltip="Custo DOM total: MDR + R$ 1 + R$ 3 por transação."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.totalTaxasDom ?? 0)
                  }
                  icon={TrendingDown}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
                <MetricCard
                  label="Taxa de Parcelamento Bruto"
                  tooltip="Todas as taxas DOM + todas as taxas Sim Int Pay do parcelamento."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.taxaParcelamentoBruto ?? 0)
                  }
                  icon={CreditCard}
                  iconClassName="text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400"
                  valueClassName="text-amber-600 dark:text-amber-400"
                />
                <MetricCard
                  label="Parcelamento - DOM"
                  tooltip="Parte do parcelamento repassada à DOM."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(
                          (atlasConsolidado?.taxaParcelamentoBruto ?? 0) -
                            (atlasConsolidado?.taxaParcelamentoSimIntPay ?? 0),
                        )
                  }
                  icon={CreditCard}
                  iconClassName="text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300"
                  valueClassName="text-rose-700 dark:text-rose-300"
                />
                <MetricCard
                  label="Parcelamento - Sim Int Pay"
                  tooltip="Valor líquido do parcelamento da Sim Int Pay."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(
                          atlasConsolidado?.taxaParcelamentoSimIntPay ?? 0,
                        )
                  }
                  icon={CreditCard}
                  iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                  valueClassName="text-violet-600 dark:text-violet-400"
                />
              </div>
            </section>

            {/* ── Detalhe Atlas ── */}
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Detalhe Atlas
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                <MetricCard
                  label="Clientes Ativos"
                  tooltip="Usuários cadastrados no AtlasHosting."
                  value={
                    isLoadingAtlasModal
                      ? 'Carregando...'
                      : `${atlasModalData?.total ?? 0} clientes`
                  }
                  icon={Users}
                  iconClassName="text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400"
                  valueClassName="text-sky-600 dark:text-sky-400"
                  onAction={() => {
                    setAtlasModalPage(1);
                    setShowAtlasModal(true);
                  }}
                  actionIcon={Eye}
                />
                <MetricCard
                  label="Taxa Adquirente DOM"
                  tooltip="MDR da DOM + R$ 1 fixo por transação. Cashback é mostrado separadamente."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(
                          (atlasConsolidado?.taxaDomPct ?? 0) +
                            (atlasConsolidado?.taxaAdquirente ?? 0),
                        )
                  }
                  icon={Wallet}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
                <MetricCard
                  label="Custo Cashback"
                  tooltip="R$ 3 por transação de cashback ao cliente."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.custoCashback ?? 0)
                  }
                  icon={TrendingDown}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
                <MetricCard
                  label="Custo Domínio"
                  tooltip="Custo real do domínio na Namecheap, sem markup."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.custoDominio ?? 0)
                  }
                  icon={TrendingDown}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
                <MetricCard
                  label="Custo Hospedagem"
                  tooltip="Custo estimado do servidor na Contabo (50% do valor faturado)."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.custoHospedagem ?? 0)
                  }
                  icon={TrendingDown}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
                <MetricCard
                  label="Receita Líquida SimIntPay"
                  tooltip="Lucro Sim Int Pay no Atlas, já sem os custos DOM."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(
                          atlasConsolidado?.receitaLiquidaSimintpay ?? 0,
                        )
                  }
                  icon={TrendingUp}
                  iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
                  valueClassName={
                    (atlasConsolidado?.receitaLiquidaSimintpay ?? 0) >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                />
                <MetricCard
                  label="Lucro Líq. Domínio"
                  tooltip="Lucro nos domínios: preço − custo Namecheap."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.lucroLiquidoDominio ?? 0)
                  }
                  icon={TrendingUp}
                  iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
                  valueClassName={
                    (atlasConsolidado?.lucroLiquidoDominio ?? 0) >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                />
                <MetricCard
                  label="Lucro Líq. VPS"
                  tooltip="Lucro no VPS: preço − custo estimado Contabo."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.lucroLiquidoVps ?? 0)
                  }
                  icon={TrendingUp}
                  iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
                  valueClassName={
                    (atlasConsolidado?.lucroLiquidoVps ?? 0) >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                />
                <MetricCard
                  label="Total Pago a Afiliados"
                  tooltip="Soma dos saques de afiliados aprovados no período."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.lucroAfiliado ?? 0)
                  }
                  icon={Wallet}
                  iconClassName="text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400"
                />
                <MetricCard
                  label="Total Repasse Afiliado"
                  tooltip="Comissões geradas no período, ainda disponíveis para saque."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.totalRepasseAfiliado ?? 0)
                  }
                  icon={Wallet}
                  iconClassName="text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400"
                />
                <MetricCard
                  label="Lucro SimIntPay — Saque"
                  tooltip="R$ 2 por saque de afiliado aprovado."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.lucroSimpayDeSaque ?? 0)
                  }
                  icon={TrendingUp}
                  iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
                  valueClassName="text-green-600 dark:text-green-400"
                />
                <MetricCard
                  label="Receita Líquida Atlas"
                  tooltip="Lucro final do Atlas, já sem custos e comissões."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : formatBRL(atlasConsolidado?.receitaLiquidaAtlas ?? 0)
                  }
                  icon={TrendingUp}
                  iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
                  valueClassName={
                    (atlasConsolidado?.receitaLiquidaAtlas ?? 0) >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                />
                <MetricCard
                  label="Saque Pendente"
                  tooltip="Saques de afiliados aguardando aprovação."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : (atlasConsolidado?.saquePendente ?? 0).toLocaleString(
                          'pt-BR',
                        )
                  }
                  icon={Wallet}
                  iconClassName="text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400"
                  valueClassName="text-yellow-600 dark:text-yellow-400"
                />
                <MetricCard
                  label="ROI SimIntPay"
                  tooltip="Lucro Sim Int Pay ÷ receita total do Atlas."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : `${(atlasConsolidado?.roiSimintpay ?? 0).toFixed(2)}%`
                  }
                  icon={TrendingUp}
                  iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
                  valueClassName={
                    (atlasConsolidado?.roiSimintpay ?? 0) >= 0
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                />
                <MetricCard
                  label="ROI Domínios"
                  tooltip="Lucro ÷ receita dos domínios."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : `${(atlasConsolidado?.roiDominios ?? 0).toFixed(2)}%`
                  }
                  icon={TrendingUp}
                  iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
                  valueClassName={
                    (atlasConsolidado?.roiDominios ?? 0) >= 0
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                />
                <MetricCard
                  label="ROI Hospedagem"
                  tooltip="Lucro ÷ receita do VPS."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : `${(atlasConsolidado?.roiHospedagem ?? 0).toFixed(2)}%`
                  }
                  icon={TrendingUp}
                  iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
                  valueClassName={
                    (atlasConsolidado?.roiHospedagem ?? 0) >= 0
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                />
                <MetricCard
                  label="ROI Atlas"
                  tooltip="Receita líquida ÷ receita bruta do Atlas."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : `${(atlasConsolidado?.roiAtlas ?? 0).toFixed(2)}%`
                  }
                  icon={TrendingUp}
                  iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
                  valueClassName={
                    (atlasConsolidado?.roiAtlas ?? 0) >= 0
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                />
                <MetricCard
                  label="Estornos"
                  tooltip="Transações estornadas no Atlas."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : (atlasConsolidado?.estornoCount ?? 0).toLocaleString(
                          'pt-BR',
                        )
                  }
                  icon={TrendingDown}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
                <MetricCard
                  label="Chargebacks"
                  tooltip="Chargebacks no Atlas."
                  value={
                    isLoadingAtlas
                      ? 'Carregando...'
                      : (atlasConsolidado?.chargebackCount ?? 0).toLocaleString(
                          'pt-BR',
                        )
                  }
                  icon={TrendingDown}
                  iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  valueClassName="text-red-600 dark:text-red-400"
                />
              </div>
            </section>
          </div>
        </TooltipRadix.Provider>
      </div>

      {/* ── Gráficos de distribuição ── */}
      <section>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Distribuição de pagamento
        </p>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
          {/* Domínios */}
          <div className="rounded-3xl border border-white/40 bg-white/70 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <div className="border-b border-zinc-200/70 px-4 py-3 dark:border-white/10">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                  <ChartPie className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Domínios
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {breakdown?.dominios.quantidade ?? 0} vendas ·{' '}
                    {fmt(breakdown?.dominios.receita)}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex min-h-[220px] flex-col items-center justify-center p-4">
              <AtlasPieChart
                items={breakdown?.dominios.distribuicaoMetodo ?? []}
                isLoading={isLoadingBreakdown}
              />
            </div>
          </div>
          {/* Hospedagem */}
          <div className="rounded-3xl border border-white/40 bg-white/70 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <div className="border-b border-zinc-200/70 px-4 py-3 dark:border-white/10">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
                  <ChartPie className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Hospedagem
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {breakdown?.hospedagem.quantidade ?? 0} vendas ·{' '}
                    {fmt(breakdown?.hospedagem.receita)}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex min-h-[220px] flex-col items-center justify-center p-4">
              <AtlasPieChart
                items={breakdown?.hospedagem.distribuicaoMetodo ?? []}
                isLoading={isLoadingBreakdown}
              />
            </div>
          </div>
          {/* Outros */}
          <div className="rounded-3xl border border-white/40 bg-white/70 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <div className="border-b border-zinc-200/70 px-4 py-3 dark:border-white/10">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300">
                  <ChartPie className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Outros
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {breakdown?.outros.quantidade ?? 0} vendas ·{' '}
                    {fmt(breakdown?.outros.receita)}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex min-h-[220px] flex-col items-center justify-center p-4">
              <AtlasPieChart
                items={breakdown?.outros.distribuicaoMetodo ?? []}
                isLoading={isLoadingBreakdown}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Transações ── */}
      <section className="flex flex-col gap-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Transações
        </p>
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/2">
          <div className="grid gap-3 md:grid-cols-3">
            <DateRangePickerField
              label="Data inicial e final:"
              value={txDateRange}
              onChange={setTxDateRange}
              theme={fieldTheme}
            />
            <Dropdown
              label="Status:"
              value={status}
              onChange={setStatus}
              theme={fieldTheme}
              variant="navbar"
              options={[
                { value: '', label: 'Todos' },
                { value: 'PENDING', label: 'Pendente' },
                { value: 'COMPLETED', label: 'Aprovado' },
                { value: 'FAILED', label: 'Recusado' },
                { value: 'REFUNDED', label: 'Estornado' },
                { value: 'EXPIRED', label: 'Expirado' },
              ]}
            />
            <Input
              label="Código da transação:"
              placeholder="UUID"
              value={codigoTransacao}
              onChange={setCodigoTransacao}
              theme={fieldTheme}
              variant="navbar"
            />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <Input
              label="Código de referência:"
              placeholder="Opcional"
              value={codigoReferencia}
              onChange={setCodigoReferencia}
              theme={fieldTheme}
              variant="navbar"
            />
            <Input
              label="Nome do comprador:"
              placeholder="Nome"
              value={compradorNome}
              onChange={setCompradorNome}
              theme={fieldTheme}
              variant="navbar"
            />
            <Input
              label="Documento:"
              placeholder="CPF/CNPJ"
              value={compradorDocumento}
              onChange={setCompradorDocumento}
              theme={fieldTheme}
              variant="navbar"
            />
            <Input
              label="E-mail:"
              placeholder="email@exemplo.com"
              value={compradorEmail}
              onChange={setCompradorEmail}
              theme={fieldTheme}
              variant="navbar"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <ActionButton variant="danger" onClick={handleClear}>
              <Eraser className="h-4 w-4" />
              Limpar
            </ActionButton>
            <ActionButton variant="primary" onClick={handleSearch}>
              <Search className="h-4 w-4" />
              {isFetchingTxs ? 'Pesquisando...' : 'Pesquisar'}
            </ActionButton>
          </div>
        </div>
        <div className="relative z-0">
          <DataTable
            columns={txColumns}
            rows={txResponse?.data ?? []}
            loading={isLoadingTxs}
            page={txResponse?.page ?? 1}
            pageSize={txResponse?.pageSize ?? PAGE_SIZE}
            total={txResponse?.total ?? 0}
            onPageChange={(p) => setTxPage(p)}
            minWidth="min-w-[1000px]"
          />
        </div>
      </section>

      {/* ── Modal Clientes AtlasHosting ───────────────────────────────────────── */}
      {showAtlasModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowAtlasModal(false)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Clientes Ativos — AtlasHosting
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {atlasModalData?.total ?? 0} clientes
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAtlasModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[60vh]">
              {isLoadingAtlasModal ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner className="h-6 w-6 text-sky-500" />
                </div>
              ) : !atlasModalData?.data.length ? (
                <p className="py-12 text-center text-xs text-zinc-400">
                  Nenhum cliente encontrado.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-white/10">
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        Nome
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        CPF
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        Email
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                        Saldo Atribuído
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                        Saldo Bloqueado
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        Cadastro
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {atlasModalData.data.map((u, i) => (
                      <tr
                        key={i}
                        className="border-b border-zinc-50 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5"
                      >
                        <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                          {u.name || '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400">
                          {u.cpf
                            ? u.cpf
                                .replace(/\D/g, '')
                                .replace(
                                  /(\d{3})(\d{3})(\d{3})(\d{2})/,
                                  '$1.$2.$3-$4',
                                )
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {u.email || '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">
                          {u.balance === null ? (
                            <span title="Histórico de atribuição incompleto ou carteira inconsistente; não representa saldo zero.">
                              Indisponível
                            </span>
                          ) : (
                            u.balance.toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">
                          {u.lockedBalance === null ? (
                            <span title="Histórico de atribuição incompleto ou carteira inconsistente; não representa saldo zero.">
                              Indisponível
                            </span>
                          ) : (
                            u.lockedBalance.toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })
                          )}
                        </td>
                        <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                          {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {(atlasModalData?.total ?? 0) > 20 && (
              <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-white/10">
                <span className="text-xs text-zinc-400">
                  {atlasModalData?.total ?? 0} resultados · pág.{' '}
                  {atlasModalPage} de{' '}
                  {Math.ceil((atlasModalData?.total ?? 1) / 20)}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={atlasModalPage <= 1}
                    onClick={() => setAtlasModalPage((p) => p - 1)}
                    className="rounded-md border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-white/10"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={
                      atlasModalPage >=
                      Math.ceil((atlasModalData?.total ?? 1) / 20)
                    }
                    onClick={() => setAtlasModalPage((p) => p + 1)}
                    className="rounded-md border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-white/10"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Areaflix panel ────────────────────────────────────────────────────────────

type AreaflixOrder = {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentMethod: string;
  status: string;
  amountCharged: string;
  platformFeeAmount: string;
  createdAt: string;
  subscriptionLink?: { name: string; frequencyType: string } | null;
};

function DaysCell({ days, active }: { days: number; active: boolean }) {
  if (!active) return <span className="text-xs text-zinc-500">—</span>;
  const cls =
    days > 7
      ? 'text-emerald-600 dark:text-emerald-400'
      : days > 0
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';
  return <span className={`text-xs font-semibold ${cls}`}>{days}d</span>;
}

function AreaflixPanel({
  dashDataInicio,
  dashDataFim,
}: {
  dashDataInicio?: string;
  dashDataFim?: string;
}) {
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';
  const { user } = useCurrentUser();
  const isMaster = isMasterAdminClient(user);

  const [panelDateRange, setPanelDateRange] = useState<DateRange>({
    start: dashDataInicio ? new Date(`${dashDataInicio}T00:00:00`) : null,
    end: dashDataFim ? new Date(`${dashDataFim}T23:59:59`) : null,
  });
  const [appliedPanelStart, setAppliedPanelStart] = useState(dashDataInicio);
  const [appliedPanelEnd, setAppliedPanelEnd] = useState(dashDataFim);
  const handleAplicarPeriodo = useCallback(() => {
    setAppliedPanelStart(formatQueryDate(panelDateRange.start));
    setAppliedPanelEnd(formatQueryDate(panelDateRange.end));
  }, [panelDateRange]);
  const periodoInicio = appliedPanelStart;
  const periodoFim = appliedPanelEnd;

  const [txPage, setTxPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [showEstornoValue, setShowEstornoValue] = useState(false);
  const [showChargebackValue, setShowChargebackValue] = useState(false);
  const [showAtivosModal, setShowAtivosModal] = useState(false);
  const [showTodosModal, setShowTodosModal] = useState(false);
  const [ativosPage, setAtivosPage] = useState(1);
  const [todosPage, setTodosPage] = useState(1);

  const AREAFLIX_PAGE_SIZE = 20;

  const apiMachine = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () =>
          typeof window !== 'undefined'
            ? (localStorage.getItem('access_token') ?? undefined)
            : undefined,
      }),
    [],
  );

  const { data: ordersData, isLoading: loadingOrders } = useQuery({
    queryKey: [
      'areaflix-report-orders',
      txPage,
      statusFilter,
      emailFilter,
      nameFilter,
    ],
    queryFn: () =>
      apiMachine.get<{ items: AreaflixOrder[]; total: number }>(
        endpoints.admin.areaflix.orders,
        {
          query: {
            page: txPage,
            pageSize: AREAFLIX_PAGE_SIZE,
            status: statusFilter || undefined,
            customerEmail: emailFilter || undefined,
            customerName: nameFilter || undefined,
          },
        },
      ),
    enabled: isMaster,
  });

  const { data: consolidadoProduto, isLoading: isLoadingConsolidado } =
    useQuery({
      queryKey: ['areaflix-consolidado', periodoInicio, periodoFim],
      enabled: isMaster,
      queryFn: () =>
        apiMachine.get<ConsolidadoProduto>(endpoints.relatorios.consolidado, {
          query: {
            periodType: 'settlement',
            transactionType: 'all',
            detalharLucro: '1',
            dataInicio: periodoInicio,
            dataFim: periodoFim,
          },
        }),
    });

  // Fetch all orders (no user filters, large page) for distribution + subscriber counts
  const { data: allOrdersDist, isLoading: isLoadingDistMetodo } = useQuery({
    queryKey: ['areaflix-dist-all-orders'],
    enabled: isMaster,
    staleTime: 5 * 60_000,
    queryFn: () =>
      apiMachine.get<{ items: AreaflixOrder[]; total: number }>(
        endpoints.admin.areaflix.orders,
        {
          query: { page: 1, pageSize: 5000 },
        },
      ),
  });

  // Dashboard stats para lucro de saque
  const { data: dashStats, isLoading: isLoadingDash } = useQuery({
    queryKey: ['areaflix-dashboard', periodoInicio, periodoFim],
    enabled: isMaster,
    queryFn: () =>
      apiMachine.get<DashboardStats>(
        endpoints.admin.plataformas.dashboard('areaflix'),
        {
          query: { dataInicio: periodoInicio, dataFim: periodoFim },
        },
      ),
  });

  // DOM/SimIntPay breakdown
  const {
    data: plataformaConsolidado,
    isError: isPlataformaConsolidadoError,
    isLoading: isLoadingPlataformaConsolidado,
    error: plataformaConsolidadoError,
  } = useQuery({
    queryKey: ['plataforma-consolidado', 'AREAFLIX', periodoInicio, periodoFim],
    enabled: isMaster,
    queryFn: () =>
      apiMachine.get<{
        taxaDomPct: number;
        taxaDomFixa: number;
        taxaDomCashback: number;
        totalTaxasDom: number;
        taxaSimIntPctBruta: number;
        taxaSimIntPctNet: number;
        taxaSimIntFixa: number;
        totalTaxasSimInt: number;
        totalRepasse?: number;
        taxaParcelamentoBruto: number;
        taxaParcelamentoSimIntPay: number;
        qtdTransacoes: number;
      }>(endpoints.relatorios.plataformaConsolidado, {
        query: {
          tag: 'AREAFLIX',
          startDate: periodoInicio ?? undefined,
          endDate: periodoFim ?? undefined,
        },
      }),
  });

  const plataformaConsolidadoErrorMessage =
    plataformaConsolidadoError instanceof Error
      ? plataformaConsolidadoError.message
      : 'Não foi possível carregar o detalhamento financeiro local.';

  const plataformaDetalhe = useMemo((): PlataformaDetalhe | null => {
    if (!consolidadoProduto) return null;
    const root = consolidadoProduto?.data ?? consolidadoProduto;
    const rawDetalhe = root?.lucroSimpayDetalhe;
    if (!rawDetalhe || typeof rawDetalhe !== 'object') return null;
    const detalhe = rawDetalhe as { plataformas?: PlataformaDetalhe[] };
    return (
      detalhe.plataformas?.find((p) => p.tag.toUpperCase() === 'AREAFLIX') ??
      null
    );
  }, [consolidadoProduto]);

  const { assinantesAtivos, clientesTotais } = useMemo(() => {
    const allItems: AreaflixOrder[] = allOrdersDist?.items ?? [];
    const activeEmails = new Set(
      allItems
        .filter((o) => isPaidStatus(o.status))
        .map((o) => o.customerEmail)
        .filter(Boolean),
    );
    const paidEmails = new Set(
      allItems
        .filter((o) => (o.status ?? '').toLowerCase() !== 'pending')
        .map((o) => o.customerEmail)
        .filter(Boolean),
    );
    return {
      assinantesAtivos: activeEmails.size,
      clientesTotais: paidEmails.size,
    };
  }, [allOrdersDist]);

  const activeSubscriberList = useMemo(() => {
    const items: AreaflixOrder[] = allOrdersDist?.items ?? [];
    const seen = new Set<string>();
    return items.filter((o) => {
      if (!isPaidStatus(o.status) || !o.customerEmail) return false;
      if (seen.has(o.customerEmail)) return false;
      seen.add(o.customerEmail);
      return true;
    });
  }, [allOrdersDist]);

  const allClientList = useMemo(() => {
    const items: AreaflixOrder[] = allOrdersDist?.items ?? [];
    const seen = new Set<string>();
    return items.filter((o) => {
      if (!o.customerEmail || (o.status ?? '').toLowerCase() === 'pending')
        return false;
      if (seen.has(o.customerEmail)) return false;
      seen.add(o.customerEmail);
      return true;
    });
  }, [allOrdersDist]);

  const MODAL_PAGE_SIZE = 20;
  const ativosSlice = activeSubscriberList.slice(
    (ativosPage - 1) * MODAL_PAGE_SIZE,
    ativosPage * MODAL_PAGE_SIZE,
  );
  const todosSlice = allClientList.slice(
    (todosPage - 1) * MODAL_PAGE_SIZE,
    todosPage * MODAL_PAGE_SIZE,
  );

  const distChartData = useMemo(() => {
    const COLORS: Record<string, string> = {
      PIX: '#10b981',
      CREDIT_CARD: '#6366f1',
      DEBIT_CARD: '#f59e0b',
    };
    const LABELS: Record<string, string> = {
      PIX: 'Pix',
      CREDIT_CARD: 'Crédito',
      DEBIT_CARD: 'Débito',
    };
    const allItems: AreaflixOrder[] = allOrdersDist?.items ?? [];
    const grouped: Record<string, { quantidade: number; valor: number }> = {};
    for (const o of allItems) {
      const method = (o.paymentMethod ?? 'PIX').toUpperCase();
      const key =
        method === 'CREDIT_CARD'
          ? 'CREDIT_CARD'
          : method === 'DEBIT_CARD'
            ? 'DEBIT_CARD'
            : 'PIX';
      if (!grouped[key]) grouped[key] = { quantidade: 0, valor: 0 };
      grouped[key].quantidade += 1;
      grouped[key].valor += Number(o.amountCharged ?? 0);
    }
    const total = allItems.length;
    const config: ChartConfig = {};
    const data = Object.entries(grouped).map(([codigo, g]) => {
      const key = codigo.replace(/[^a-zA-Z0-9_-]/g, '_');
      config[key] = {
        label: LABELS[codigo] ?? codigo,
        color: COLORS[codigo] ?? '#94a3b8',
      };
      return {
        chartKey: key,
        nome: LABELS[codigo] ?? codigo,
        quantidade: g.quantidade,
        valor: g.valor,
        percentual: total > 0 ? (g.quantidade / total) * 100 : 0,
        fill: `var(--color-${key})`,
      };
    });
    return { data, config };
  }, [allOrdersDist]);

  const orders: AreaflixOrder[] = ordersData?.items ?? [];
  const totalOrders: number = ordersData?.total ?? 0;

  const orderColumns: DataTableColumn<AreaflixOrder>[] = useMemo(
    () => [
      {
        key: 'customerName',
        header: 'Cliente',
        className: 'text-left',
        headerClassName: 'text-left',
        render: (r) => (
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {r.customerName ?? '-'}
          </span>
        ),
      },
      {
        key: 'customerEmail',
        header: 'Email',
        className: 'text-left',
        headerClassName: 'text-left',
        render: (r) => (
          <span className="text-xs text-zinc-400">
            {r.customerEmail ?? '-'}
          </span>
        ),
      },
      {
        key: 'plan',
        header: 'Plano',
        render: (r) => (
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            {r.subscriptionLink?.name ?? '-'}
          </span>
        ),
      },
      {
        key: 'method',
        header: 'Método',
        render: (r) => {
          const isPix = r.paymentMethod !== 'CREDIT_CARD';
          return (
            <div className="flex items-center justify-center gap-1.5">
              {isPix ? (
                <QrCode className="h-4 w-4 text-emerald-700" />
              ) : (
                <CreditCard className="h-4 w-4 text-zinc-500" />
              )}
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {isPix ? 'Pix' : 'Cartão'}
              </span>
            </div>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => (
          <Badge value={r.status}>{mapAreaflixStatus(r.status)}</Badge>
        ),
      },
      {
        key: 'days',
        header: 'Dias',
        render: (r) => {
          const exp = calcExpiresAt(
            r.createdAt,
            r.subscriptionLink?.frequencyType,
          );
          return (
            <DaysCell
              days={daysRemaining(exp)}
              active={isPaidStatus(r.status)}
            />
          );
        },
      },
      {
        key: 'amount',
        header: 'Valor',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (r) => (
          <MoneyCell
            value={Number(r.amountCharged)}
            className="font-medium text-emerald-600 dark:text-emerald-400"
          />
        ),
      },
      {
        key: 'date',
        header: 'Data',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (r) => (
          <span className="text-sm text-zinc-500">
            {formatDate(r.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (!isMaster) {
    return (
      <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-zinc-200 dark:border-white/10">
        <p className="text-xs text-zinc-400">
          Acesso restrito ao módulo master.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Período do produto ── */}
      <section>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Período do produto
        </p>
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/2">
          <div className="flex-1 min-w-[260px]">
            <DateRangePickerField
              label="Data inicial e final:"
              value={panelDateRange}
              onChange={setPanelDateRange}
              theme={fieldTheme}
            />
          </div>
          <ActionButton variant="primary" onClick={handleAplicarPeriodo}>
            <Search className="h-4 w-4" />
            Aplicar
          </ActionButton>
        </div>
        {(periodoInicio || periodoFim) && (
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
            Período aplicado: {formatDateBR(periodoInicio)} a{' '}
            {formatDateBR(periodoFim)}
          </p>
        )}
        {isPlataformaConsolidadoError && (
          <div className="mt-3 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              <strong>Detalhamento financeiro indisponível.</strong>{' '}
              {plataformaConsolidadoErrorMessage}
            </p>
          </div>
        )}
      </section>

      {/* ── Resumo financeiro ── */}
      <section>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Resumo financeiro do período
        </p>
        {isLoadingConsolidado ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner size={24} className="text-zinc-400" />
          </div>
        ) : (
          <TooltipRadix.Provider delayDuration={200}>
            <div className="flex flex-col gap-8">
              {/* ── Taxas Sim Int Pay ── */}
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Taxas Sim Int Pay
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  <MetricCard
                    label="Receita Líquida - Sim Int Pay"
                    tooltip="Receita líquida da Sim Int Pay: o que sobra depois de pagar todos os custos da DOM (MDR percentual + R$ 1 por transação + R$ 3 de cashback)."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            plataformaConsolidado?.taxaSimIntPctNet ?? 0,
                          )
                    }
                    icon={TrendingUp}
                    iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                    valueClassName="text-violet-600 dark:text-violet-400"
                  />
                  <MetricCard
                    label="Taxa por Transação - Sim Int Pay"
                    tooltip="R$ 4 por transação cobrados pela Sim Int Pay."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.taxaSimIntFixa ?? 0)
                    }
                    icon={TrendingUp}
                    iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                    valueClassName="text-violet-600 dark:text-violet-400"
                  />
                  <MetricCard
                    label="Total de Taxas - Sim Int Pay"
                    tooltip="Receita Sim Int Pay: margem % + taxa por transação."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            plataformaConsolidado?.totalTaxasSimInt ?? 0,
                          )
                    }
                    icon={TrendingUp}
                    iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                    valueClassName="text-violet-600 dark:text-violet-400"
                  />
                </div>
              </section>

              {/* ── Taxas DOM ── */}
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Taxas DOM
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  <MetricCard
                    label="Taxa Percentual - DOM"
                    tooltip="MDR percentual da DOM no período."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.taxaDomPct ?? 0)
                    }
                    icon={TrendingDown}
                    iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                    valueClassName="text-red-600 dark:text-red-400"
                  />
                  <MetricCard
                    label="Taxa por Transação - DOM"
                    tooltip="R$ 1 por transação cobrado pela DOM."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.taxaDomFixa ?? 0)
                    }
                    icon={TrendingDown}
                    iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                    valueClassName="text-red-600 dark:text-red-400"
                  />
                  <MetricCard
                    label="Taxa Cashback - DOM"
                    tooltip="R$ 3 por transação de cashback DOM."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.taxaDomCashback ?? 0)
                    }
                    icon={TrendingDown}
                    iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                    valueClassName="text-red-600 dark:text-red-400"
                  />
                  <MetricCard
                    label="Total de Taxas - DOM"
                    tooltip="Custo DOM total: MDR + R$ 1 + R$ 3 por transação."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.totalTaxasDom ?? 0)
                    }
                    icon={TrendingDown}
                    iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                    valueClassName="text-red-600 dark:text-red-400"
                  />
                  <MetricCard
                    label="Taxa de Parcelamento Bruto"
                    tooltip="Todas as taxas DOM + todas as taxas Sim Int Pay do parcelamento."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            plataformaConsolidado?.taxaParcelamentoBruto ?? 0,
                          )
                    }
                    icon={CreditCard}
                    iconClassName="text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400"
                    valueClassName="text-amber-600 dark:text-amber-400"
                  />
                  <MetricCard
                    label="Parcelamento - DOM"
                    tooltip="Parte do parcelamento repassada à DOM."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            (plataformaConsolidado?.taxaParcelamentoBruto ??
                              0) -
                              (plataformaConsolidado?.taxaParcelamentoSimIntPay ??
                                0),
                          )
                    }
                    icon={CreditCard}
                    iconClassName="text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300"
                    valueClassName="text-rose-700 dark:text-rose-300"
                  />
                  <MetricCard
                    label="Parcelamento - Sim Int Pay"
                    tooltip="Valor líquido do parcelamento da Sim Int Pay."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            plataformaConsolidado?.taxaParcelamentoSimIntPay ??
                              0,
                          )
                    }
                    icon={CreditCard}
                    iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                    valueClassName="text-violet-600 dark:text-violet-400"
                  />
                </div>
              </section>

              {/* ── Detalhe ── */}
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Detalhe
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  <MetricCard
                    label="Clientes Totais"
                    tooltip="Clientes que já pagaram na Áreaflix."
                    value={
                      isLoadingDistMetodo
                        ? 'Carregando...'
                        : `${clientesTotais} clientes`
                    }
                    valueClassName="text-indigo-600 dark:text-indigo-400"
                    icon={BarChart3}
                    iconClassName="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-400"
                    onAction={() => {
                      setTodosPage(1);
                      setShowTodosModal(true);
                    }}
                    actionIcon={Eye}
                  />
                  <MetricCard
                    label="Receita Total"
                    tooltip="Valor bruto das vendas aprovadas."
                    value={formatBRL(plataformaDetalhe?.subtotalBruto)}
                    valueClassName="text-emerald-600 dark:text-emerald-400"
                    icon={TrendingUp}
                    iconClassName="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400"
                  />
                  <MetricCard
                    label="Total de Repasse"
                    tooltip="Soma do líquido de cada transação."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            plataformaConsolidado?.totalRepasse ??
                              (plataformaDetalhe?.subtotalBruto ?? 0) -
                                (plataformaConsolidado?.totalTaxasSimInt ?? 0),
                          )
                    }
                    valueClassName="text-cyan-600 dark:text-cyan-400"
                    icon={Banknote}
                    iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                  />
                  <MetricCard
                    label="Receita Liquidada Sim Int Pay"
                    tooltip="Lucro do produto: taxas Sim Int Pay − taxas DOM."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            (plataformaConsolidado?.totalTaxasSimInt ?? 0) -
                              (plataformaConsolidado?.totalTaxasDom ?? 0),
                          )
                    }
                    valueClassName="text-teal-600 dark:text-teal-400"
                    icon={DollarSign}
                    iconClassName="text-teal-600 bg-teal-50 dark:bg-teal-950/30 dark:text-teal-400"
                  />
                  <MetricCard
                    label="Taxa de Saque — Simintpay"
                    tooltip={`Lucro com saques aprovados (${dashStats?.saqueFees?.quantidade ?? 0} saques).`}
                    value={
                      isLoadingDash
                        ? 'Carregando...'
                        : formatBRL(dashStats?.saqueFees?.lucroSimpay ?? 0)
                    }
                    valueClassName="text-violet-600 dark:text-violet-400"
                    icon={Wallet}
                    iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                  />
                  <MetricCard
                    label="ROI Sim Int"
                    tooltip="Lucro Sim Int Pay ÷ receita bruta."
                    value={
                      (plataformaDetalhe?.subtotalBruto ?? 0) > 0
                        ? `${((((plataformaConsolidado?.totalTaxasSimInt ?? 0) - (plataformaConsolidado?.totalTaxasDom ?? 0)) / (plataformaDetalhe?.subtotalBruto ?? 1)) * 100).toFixed(2)}%`
                        : '—'
                    }
                    valueClassName="text-cyan-600 dark:text-cyan-400"
                    icon={TrendingUp}
                    iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                  />
                  <MetricCard
                    label="ROI Produto"
                    tooltip="Repasse ao produto ÷ receita bruta."
                    value={
                      (plataformaDetalhe?.subtotalBruto ?? 0) > 0
                        ? `${((((plataformaDetalhe?.subtotalBruto ?? 0) - (plataformaConsolidado?.totalTaxasSimInt ?? 0)) / (plataformaDetalhe?.subtotalBruto ?? 1)) * 100).toFixed(2)}%`
                        : '—'
                    }
                    valueClassName="text-indigo-600 dark:text-indigo-400"
                    icon={Percent}
                    iconClassName="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-400"
                  />
                  <MetricCard
                    label="Estornos"
                    tooltip="Estornos no produto. Ícone alterna quantidade/valor."
                    value={
                      isLoadingDash
                        ? 'Carregando...'
                        : showEstornoValue
                          ? formatBRL(dashStats?.estornos?.valorLiquido ?? 0)
                          : `${dashStats?.estornos?.quantidade ?? 0} estornos`
                    }
                    valueClassName="text-rose-600 dark:text-rose-400"
                    icon={ShieldAlert}
                    iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
                    onAction={() => setShowEstornoValue((v) => !v)}
                    actionIcon={RefreshCw}
                  />
                  <MetricCard
                    label="Chargebacks"
                    tooltip="Chargebacks no produto. Ícone alterna quantidade/valor."
                    value={
                      isLoadingDash
                        ? 'Carregando...'
                        : showChargebackValue
                          ? formatBRL(dashStats?.chargebacks?.valorLiquido ?? 0)
                          : `${dashStats?.chargebacks?.quantidade ?? 0} chargebacks`
                    }
                    valueClassName="text-orange-600 dark:text-orange-400"
                    icon={AlertTriangle}
                    iconClassName="text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400"
                    onAction={() => setShowChargebackValue((v) => !v)}
                    actionIcon={RefreshCw}
                  />
                </div>
              </section>
            </div>
          </TooltipRadix.Provider>
        )}
      </section>

      {/* ── Distribuição de pagamento ── */}
      <section>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Distribuição de pagamento
        </p>
        <div className="max-w-sm rounded-3xl border border-white/40 bg-white/70 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <div className="border-b border-zinc-200/70 px-4 py-3 dark:border-white/10">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                <ChartPie className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Distribuição por método
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Pix · Crédito · Débito — transações aprovadas
                </p>
              </div>
            </div>
          </div>
          <div className="flex min-h-[240px] flex-col items-center justify-center p-4">
            {isLoadingDistMetodo ? (
              <div className="flex h-[200px] w-full max-w-[220px] animate-pulse items-center justify-center rounded-full bg-zinc-200/50 dark:bg-white/10" />
            ) : distChartData.data.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Sem transações no período.
              </p>
            ) : (
              <ChartContainer
                config={distChartData.config}
                className="mx-auto aspect-square h-[min(240px,80vw)] w-full max-w-[240px]"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        nameKey="chartKey"
                        hideLabel
                        formatter={(value, _name, item) => {
                          const p = item?.payload as
                            | {
                                nome?: string;
                                percentual?: number;
                                valor?: number;
                              }
                            | undefined;
                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-muted-foreground">
                                {p?.nome ?? '—'}
                              </span>
                              <span className="font-mono font-medium tabular-nums">
                                {Number(value).toLocaleString('pt-BR')} (
                                {Number(p?.percentual ?? 0).toFixed(1)}%)
                              </span>
                              <span className="text-xs text-zinc-400">
                                {formatBRL(p?.valor)}
                              </span>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <Pie
                    data={distChartData.data}
                    dataKey="quantidade"
                    nameKey="chartKey"
                    innerRadius={48}
                    strokeWidth={2}
                    className="stroke-background"
                    isAnimationActive={false}
                  >
                    {distChartData.data.map((entry) => (
                      <Cell key={entry.chartKey} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartLegend
                    content={
                      <ChartLegendContent
                        nameKey="chartKey"
                        className="flex-wrap gap-x-3 gap-y-1"
                      />
                    }
                    className="-translate-y-2"
                  />
                </PieChart>
              </ChartContainer>
            )}
          </div>
        </div>
      </section>

      {/* ── Transações ── */}
      <section className="flex flex-col gap-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Transações
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Dropdown
            theme={fieldTheme}
            options={[
              { value: '', label: 'Todos os Status' },
              { value: 'paid', label: 'Pago' },
              { value: 'active', label: 'Ativo' },
              { value: 'pending', label: 'Pendente' },
              { value: 'expired', label: 'Expirado' },
              { value: 'cancelled', label: 'Cancelado' },
            ]}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setTxPage(1);
            }}
            placeholder="Todos os Status"
          />
          <Input
            placeholder="Filtrar por email"
            value={emailFilter}
            onChange={(v) => {
              setEmailFilter(v);
              setTxPage(1);
            }}
            theme={fieldTheme}
            variant="navbar"
          />
          <Input
            placeholder="Filtrar por nome"
            value={nameFilter}
            onChange={(v) => {
              setNameFilter(v);
              setTxPage(1);
            }}
            theme={fieldTheme}
            variant="navbar"
          />
          {(statusFilter || emailFilter || nameFilter) && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('');
                setEmailFilter('');
                setNameFilter('');
                setTxPage(1);
              }}
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              Limpar
            </button>
          )}
        </div>
        <DataTable
          columns={orderColumns}
          rows={orders}
          loading={loadingOrders}
          page={txPage}
          pageSize={AREAFLIX_PAGE_SIZE}
          total={totalOrders}
          onPageChange={setTxPage}
          emptyTitle="Nenhuma ordem encontrada"
          emptyDescription="Tente ajustar os filtros acima."
        />
      </section>

      {/* ── Modal Clientes Totais ─────────────────────────────────────────────── */}
      {showTodosModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowTodosModal(false)}
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Clientes Totais — AREAFLIX
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {allClientList.length} clientes cadastrados
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTodosModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[60vh]">
              {!todosSlice.length ? (
                <p className="py-12 text-center text-xs text-zinc-400">
                  Nenhum cliente encontrado.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-white/10">
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        Nome
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        Email
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        Cadastro
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {todosSlice.map((o, i) => (
                      <tr
                        key={i}
                        className="border-b border-zinc-50 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5"
                      >
                        <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                          {o.customerName || '—'}
                        </td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {o.customerEmail || '—'}
                        </td>
                        <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                          {new Date(o.createdAt).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {allClientList.length > MODAL_PAGE_SIZE && (
              <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-white/10">
                <span className="text-xs text-zinc-400">
                  {allClientList.length} resultados · pág. {todosPage} de{' '}
                  {Math.ceil(allClientList.length / MODAL_PAGE_SIZE)}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={todosPage <= 1}
                    onClick={() => setTodosPage((p) => p - 1)}
                    className="rounded-md border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-white/10"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={
                      todosPage >=
                      Math.ceil(allClientList.length / MODAL_PAGE_SIZE)
                    }
                    onClick={() => setTodosPage((p) => p + 1)}
                    className="rounded-md border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-white/10"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Generic platform panel ────────────────────────────────────────────────────

type AppliedFilters = {
  periodType: string;
  dataInicio?: string;
  dataFim?: string;
  status?: string;
  codigoTransacao?: string;
  codigoReferencia?: string;
  compradorNome?: string;
  compradorDocumento?: string;
  compradorEmail?: string;
  tipoTransacao?: string;
};

const PAGE_SIZE = 20;

function GenericPlatformPanel({
  tag,
  accent,
  isEbook,
  dashDataInicio,
  dashDataFim,
  unified = false,
  initialMethod = '',
}: {
  unified?: boolean;
  initialMethod?: string;
  tag: string;
  accent: string;
  isEbook: boolean;
  dashDataInicio?: string;
  dashDataFim?: string;
}) {
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  // Period picker — independent per product, initialized from parent dates.
  // Sem datas do pai, cai no mês corrente (ver currentMonthStart) para que os dois
  // endpoints do resumo consultem sempre a mesma janela.
  const [panelDateRange, setPanelDateRange] = useState<DateRange>({
    start: dashDataInicio
      ? new Date(`${dashDataInicio}T00:00:00`)
      : currentMonthStart(),
    end: dashDataFim ? new Date(`${dashDataFim}T23:59:59`) : currentMonthEnd(),
  });
  const [appliedPanelStart, setAppliedPanelStart] = useState(
    dashDataInicio ?? formatQueryDate(currentMonthStart()),
  );
  const [appliedPanelEnd, setAppliedPanelEnd] = useState(
    dashDataFim ?? formatQueryDate(currentMonthEnd()),
  );
  // Filtro de método de pagamento dos cards do "Resumo financeiro do período"
  // (Receita Total, Repasse, Taxas DOM, Taxas Sim Int Pay) — independente do
  // filtro de método da tabela de transações abaixo.
  const [metodoPagamentoResumo, setMetodoPagamentoResumo] =
    useState(initialMethod);

  // Se o usuário limpar o período e aplicar, volta ao mês corrente em vez de mandar
  // as duas consultas sem data (janelas divergentes → cards derivados absurdos).
  const handleAplicarPeriodo = useCallback(() => {
    setAppliedPanelStart(
      formatQueryDate(panelDateRange.start) ??
        formatQueryDate(currentMonthStart()),
    );
    setAppliedPanelEnd(
      formatQueryDate(panelDateRange.end) ?? formatQueryDate(currentMonthEnd()),
    );
  }, [panelDateRange]);

  const periodoInicio = appliedPanelStart;
  const periodoFim = appliedPanelEnd;

  // filter inputs
  const [txDateRange, setTxDateRange] = useState<DateRange>({
    start:
      unified && dashDataInicio ? new Date(`${dashDataInicio}T00:00:00`) : null,
    end: unified && dashDataFim ? new Date(`${dashDataFim}T00:00:00`) : null,
  });
  const [status, setStatus] = useState('');
  const [codigoTransacao, setCodigoTransacao] = useState('');
  const [codigoReferencia, setCodigoReferencia] = useState('');
  const [compradorNome, setCompradorNome] = useState('');
  const [compradorDocumento, setCompradorDocumento] = useState('');
  const [compradorEmail, setCompradorEmail] = useState('');
  const [tipoTransacao, setTipoTransacao] = useState('todos');
  // Filtro de método de pagamento da tabela de transações — independente do
  // filtro dos cards do resumo financeiro (metodoPagamentoResumo).
  const [metodoPagamentoTx, setMetodoPagamentoTx] = useState(initialMethod);
  const [txPage, setTxPage] = useState(1);
  const [showEstornoValue, setShowEstornoValue] = useState(false);
  const [showChargebackValue, setShowChargebackValue] = useState(false);

  const [showActiveSellersModal, setShowActiveSellersModal] = useState(false);
  const [activeSellersPage, setActiveSellersPage] = useState(1);
  const [activeSellersSearch, setActiveSellersSearch] = useState('');
  const [showAllUsersModal, setShowAllUsersModal] = useState(false);
  const [showSaquesModal, setShowSaquesModal] = useState(false);
  const [allUsersPage, setAllUsersPage] = useState(1);
  const [allUsersSearch, setAllUsersSearch] = useState('');

  // Dashboard stats
  const {
    data: dashStats,
    isLoading: isLoadingDash,
    isError: dashboardError,
    refetch: retryDashboard,
  } = useQuery({
    queryKey: ['produto-dashboard', tag, periodoInicio, periodoFim],
    enabled: !!tag,
    queryFn: async () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      });
      return api.get<DashboardStats>(
        endpoints.admin.plataformas.dashboard(tag.toLowerCase()),
        {
          query: { dataInicio: periodoInicio, dataFim: periodoFim },
        },
      );
    },
  });

  // Só a Renovada opera maquineta física — nas demais a seção fica oculta.
  const showMaquinetaCards = tag === 'RENOVADA';

  // Saques do período, um a um, com a taxa cobrada em cada — abre no modal do card
  // "Taxa de Saque — Simintpay". Só busca quando o modal é aberto.
  type SaqueDetalhado = {
    id: string;
    solicitadoEm: string;
    aprovadoEm: string;
    usuario: string;
    email: string;
    chavePix: string;
    valorBruto: number;
    valorLiquido: number;
    taxaCobrada: number;
    status: string;
  };
  const SAQUE_STATUS_PT: Record<string, string> = {
    PENDING: 'Pendente',
    APPROVED: 'Aprovado',
    COMPLETED: 'Concluído',
    REJECTED: 'Recusado',
  };
  const { data: saquesDetalhados, isLoading: isLoadingSaquesDetalhados } =
    useQuery({
      queryKey: ['produto-saques', tag, periodoInicio, periodoFim],
      enabled: !!tag && showSaquesModal,
      queryFn: async () => {
        const api = createApiClient({
          baseUrl: getDefaultApiBaseUrl(),
          getToken: () => localStorage.getItem('access_token') ?? undefined,
        });
        return api.get<{
          data: SaqueDetalhado[];
          quantidade: number;
        }>(endpoints.admin.plataformas.saques(tag.toLowerCase()), {
          query: { dataInicio: periodoInicio, dataFim: periodoFim },
        });
      },
    });

  // DOM/SimIntPay breakdown para esta plataforma
  const {
    data: plataformaConsolidado,
    isError: isPlataformaConsolidadoError,
    isLoading: isLoadingPlataformaConsolidado,
    error: plataformaConsolidadoError,
    refetch: retryBreakdown,
  } = useQuery({
    queryKey: [
      'plataforma-consolidado',
      tag,
      periodoInicio,
      periodoFim,
      metodoPagamentoResumo,
    ],
    enabled: !!tag,
    queryFn: async () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      });
      return api.get<{
        taxaDomPct: number;
        taxaDomFixa: number;
        taxaDomCashback: number;
        totalTaxasDom: number;
        taxaSimIntPctBruta?: number;
        taxaSimIntPctNet: number;
        taxaSimIntFixa: number;
        totalTaxasSimInt: number;
        totalRepasse?: number;
        taxaParcelamentoBruto: number;
        taxaParcelamentoSimIntPay: number;
        qtdTransacoes: number;
        receitaTotal: number;

        // Parcelamento (cartão de crédito)
        parcBruto: number;
        parcRepasse: number;
        // Maquineta (venda física)
        qtdMaquineta: number;
        maqBruto: number;
        maqNet: number;
        maqDom: number;
        maqSimInt: number;
      }>(endpoints.relatorios.plataformaConsolidado, {
        query: {
          tag,
          startDate: periodoInicio ?? undefined,
          endDate: periodoFim ?? undefined,
          metodoPagamento: metodoPagamentoResumo || undefined,
        },
      });
    },
  });

  const plataformaConsolidadoErrorMessage =
    plataformaConsolidadoError instanceof Error
      ? plataformaConsolidadoError.message
      : 'Não foi possível carregar o detalhamento de taxas da DOM.';

  // Consolidado filtrado pelo período do produto (base para os MetricCards)
  const {
    data: consolidadoProduto,
    isLoading: isLoadingConsolidadoProduto,
    isError: summaryError,
    refetch: retrySummary,
  } = useQuery({
    queryKey: [
      'produto-consolidado',
      tag,
      periodoInicio,
      periodoFim,
      metodoPagamentoResumo,
    ],
    enabled: !!tag,
    queryFn: async () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      });
      return api.get<ConsolidadoProduto>(endpoints.relatorios.consolidado, {
        query: {
          periodType: 'settlement',
          transactionType: 'all',
          detalharLucro: '1',
          dataInicio: periodoInicio,
          dataFim: periodoFim,
          metodoPagamento: metodoPagamentoResumo || undefined,
        },
      });
    },
  });

  const plataformaDetalheProduto = useMemo((): PlataformaDetalhe | null => {
    if (!consolidadoProduto) return null;
    const root = consolidadoProduto?.data ?? consolidadoProduto;
    const rawDetalhe = root?.lucroSimpayDetalhe;
    if (!rawDetalhe || typeof rawDetalhe !== 'object') return null;
    const detalhe = rawDetalhe as { plataformas?: PlataformaDetalhe[] };
    // Tolerante a aliases: o produto "EBOOKSIM" é agregado como "EBOOK" no consolidado.
    // Um find estrito retornava null → Receita Total R$ 0,00 mesmo com vendas no período.
    return findPlataformaDetalheByTag(detalhe.plataformas, tag);
  }, [consolidadoProduto, tag]);

  // Payment method distribution for this platform
  const { data: distMetodo, isLoading: isLoadingDistMetodo } = useQuery({
    queryKey: ['produto-distribuicao-metodo', tag, periodoInicio, periodoFim],
    enabled: !!tag,
    queryFn: async () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      });
      return api.get<{
        total: number;
        items: {
          codigo: string;
          nome: string;
          quantidade: number;
          valor: number;
          percentual: number;
        }[];
      }>(endpoints.admin.plataformas.distribuicaoMetodo(tag.toLowerCase()), {
        query: { dataInicio: periodoInicio, dataFim: periodoFim },
      });
    },
  });

  // Pending withdrawals filtrados pela plataforma selecionada
  const slugModulo = tag.toLowerCase();
  const {
    data: saquesPendentesData,
    isLoading: isLoadingSaquesPendentes,
    isError: withdrawalsError,
    refetch: retryWithdrawals,
  } = useQuery({
    queryKey: ['saques-pendentes-admin', slugModulo],
    staleTime: 60_000,
    enabled: !!tag,
    queryFn: async () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      });
      return api.get<{ total: number }>(endpoints.admin.saques.list, {
        query: { status: 'PENDING', pageSize: '1', modulo: slugModulo },
      });
    },
  });

  // Seller / subscriber stats (EBOOK, PAGATG, AREAFLIX)
  const showSellerStats =
    tag === 'EBOOK' ||
    tag === 'EBOOKSIM' ||
    tag === 'PAGATG' ||
    tag === 'AREAFLIX';
  const sellerLabel =
    tag === 'AREAFLIX' ? 'Assinantes Ativos' : 'Sellers Ativos';
  const contasLabel =
    tag === 'AREAFLIX' ? 'Clientes Totais' : 'Quantidade de Contas';
  const sellerTooltip =
    tag === 'AREAFLIX'
      ? 'Clientes com assinatura ativa na plataforma.'
      : 'Vendedores que realizaram ao menos 1 venda no mês atual.';
  const contasTooltip =
    tag === 'AREAFLIX'
      ? 'Total de clientes que pagaram ao menos uma vez.'
      : 'Total de contas cadastradas na plataforma.';
  const {
    data: sellerStats,
    isLoading: isLoadingSellerStats,
    isError: sellersError,
    refetch: retrySellers,
  } = useQuery({
    queryKey: ['seller-stats', tag],
    enabled: showSellerStats,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      });
      return api.get<{ totalContas: number; sellersAtivos: number }>(
        endpoints.internalStats.sellerStats(tag.toLowerCase()),
      );
    },
  });

  type ActiveSeller = {
    name: string;
    email: string;
    cpf: string;
    balance: number | null;
    lockedBalance: number | null;
    balanceStatus?: 'complete' | 'unavailable';
    createdAt: string;
    status?: string;
    isRegisteredInSimIntPay?: boolean;
  };

  const { data: activeSellersData, isLoading: isLoadingActiveSellers } =
    useQuery({
      queryKey: ['active-sellers', tag, activeSellersPage],
      enabled: showActiveSellersModal && showSellerStats,
      staleTime: 2 * 60_000,
      queryFn: async () => {
        const api = createApiClient({
          baseUrl: getDefaultApiBaseUrl(),
          getToken: () => localStorage.getItem('access_token') ?? undefined,
        });
        return api.get<{
          data: ActiveSeller[];
          total: number;
          page: number;
          pageSize: number;
        }>(endpoints.internalStats.sellersAtivos(tag.toLowerCase()), {
          query: { page: String(activeSellersPage), pageSize: '20' },
        });
      },
    });

  const { data: allUsersData, isLoading: isLoadingAllUsers } = useQuery({
    queryKey: ['all-users', tag, allUsersPage],
    enabled: showAllUsersModal && showSellerStats,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      });
      return api.get<{
        data: ActiveSeller[];
        total: number;
        page: number;
        pageSize: number;
      }>(endpoints.internalStats.sellersAtivos(tag.toLowerCase()), {
        query: {
          page: String(allUsersPage),
          pageSize: '100',
          apenasAtivos: 'false',
        },
      });
    },
  });

  // Transactions
  const { data: txResponse, isLoading: isLoadingTxs } = useQuery({
    queryKey: [
      'produto-transacoes',
      tag,
      txPage,
      formatQueryDate(txDateRange.start),
      formatQueryDate(txDateRange.end),
      status,
      codigoTransacao,
      codigoReferencia,
      compradorNome,
      compradorDocumento,
      compradorEmail,
      tipoTransacao,
      metodoPagamentoTx,
    ],
    enabled: !!tag,
    queryFn: async () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      });
      return api.get<TransactionPage>(
        endpoints.admin.plataformas.transacoes(tag.toLowerCase()),
        {
          query: {
            page: txPage,
            pageSize: PAGE_SIZE,
            periodType: 'sale',
            dataInicio: formatQueryDate(txDateRange.start) ?? undefined,
            dataFim: formatQueryDate(txDateRange.end) ?? undefined,
            status: status || undefined,
            codigoTransacao: codigoTransacao || undefined,
            codigoReferencia: codigoReferencia || undefined,
            compradorNome: compradorNome || undefined,
            compradorDocumento: compradorDocumento || undefined,
            compradorEmail: compradorEmail || undefined,
            ...(tipoTransacao !== 'todos' ? { tipoTransacao } : {}),
            metodoPagamento: metodoPagamentoTx || undefined,
          },
        },
      );
    },
  });

  const handleClear = useCallback(() => {
    setTxDateRange({ start: null, end: null });
    setStatus('');
    setCodigoTransacao('');
    setCodigoReferencia('');
    setCompradorNome('');
    setCompradorDocumento('');
    setCompradorEmail('');
    setTipoTransacao('todos');
    setMetodoPagamentoTx('');
    setTxPage(1);
  }, []);

  const columns = useMemo(
    () => [
      {
        key: 'id',
        header: 'ID',
        render: (row: ReportTransaction) => (
          <span className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
            {row.id.slice(0, 8)}...
          </span>
        ),
      },
      {
        key: 'descricao',
        header: 'Descrição',
        className: 'text-left',
        headerClassName: 'text-left',
        render: (row: ReportTransaction) => (
          <span className="truncate text-sm text-zinc-900 dark:text-zinc-100">
            {formatTransacaoDescricaoUi(row.descricao) || '-'}
          </span>
        ),
      },
      {
        key: 'cliente',
        header: 'Cliente',
        className: 'text-left',
        headerClassName: 'text-left',
        render: (row: ReportTransaction) => (
          <div className="flex flex-col">
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {row.cliente?.nome ?? '-'}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatDocument(row.cliente?.documento)}
            </span>
          </div>
        ),
      },
      {
        key: 'metodoPagamento',
        header: 'Método',
        render: (row: ReportTransaction) => {
          const m = String(row.metodoPagamento ?? '').toUpperCase();
          const isPix = m === 'PIX';
          const isBoleto = m === 'BOLETO';
          return (
            <div className="flex items-center justify-center gap-2">
              {isPix ? (
                <QrCode className="h-4 w-4 text-emerald-700" />
              ) : isBoleto ? (
                <Barcode className="h-4 w-4 text-zinc-700 dark:text-zinc-400" />
              ) : (
                <CreditCard className="h-4 w-4 text-zinc-700 dark:text-zinc-400" />
              )}
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {isPix ? 'Pix' : isBoleto ? 'Boleto' : 'Cartão'}
              </span>
            </div>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (row: ReportTransaction) => (
          <Badge value={row.status}>{mapStatusLabel(row.status)}</Badge>
        ),
      },
      {
        key: 'valorBruto',
        header: 'Valor Bruto',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.valorBruto}
            className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
          />
        ),
      },
      {
        // MDR é somente a parcela percentual da DOM. A taxa fixa por transação
        // fica na coluna seguinte e ambas formam o "Total taxas - DOM".
        key: 'taxaDom',
        header: 'MDR - DOM (%)',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaDom}
            className="text-sm font-medium text-red-500 dark:text-red-400"
          />
        ),
      },
      {
        key: 'taxaCashback',
        header: 'Cashback - DOM',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaCashback}
            className="text-sm font-medium text-red-500 dark:text-red-400"
          />
        ),
      },
      {
        key: 'taxaFixaDom',
        header: 'Taxa transação - DOM',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaFixa}
            className="text-sm font-medium text-red-500 dark:text-red-400"
          />
        ),
      },
      {
        key: 'totalTaxasDom',
        header: 'Total taxas - DOM',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => {
          const v =
            Number(row.taxaDom ?? 0) +
            Number(row.taxaCashback ?? 0) +
            Number(row.taxaFixa ?? 0);
          return (
            <MoneyCell
              value={v}
              className="text-sm font-bold text-red-600 dark:text-red-400"
            />
          );
        },
      },
      {
        key: 'taxaSimIntPay',
        header: 'Taxa - Sim Int Pay (%)',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaSimIntPay}
            className="text-sm font-medium text-emerald-500 dark:text-emerald-400"
          />
        ),
      },
      {
        key: 'taxaServico',
        header: 'Taxa transação - Sim Int Pay',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <MoneyCell
            value={row.taxaServico}
            className="text-sm font-medium text-emerald-500 dark:text-emerald-400"
          />
        ),
      },
      {
        key: 'totalTaxasSimInt',
        header: 'Total taxas - Sim Int Pay',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => {
          const v =
            Number(row.taxaSimIntPay ?? 0) + Number(row.taxaServico ?? 0);
          return (
            <MoneyCell
              value={v}
              className="text-sm font-bold text-emerald-600 dark:text-emerald-400"
            />
          );
        },
      },
      {
        key: 'lucroPrejuizo',
        header: 'Lucro',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => {
          const v = Number(row.lucroPrejuizo ?? 0);
          return (
            <MoneyCell
              value={v}
              className={`font-medium tabular-nums ${v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
            />
          );
        },
      },
      {
        key: 'criadoEm',
        header: 'Data',
        className: 'text-right',
        headerClassName: 'text-right',
        render: (row: ReportTransaction) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatDateTime(row.criadoEm)}
          </span>
        ),
      },
    ],
    [],
  );

  const distChartData = useMemo(() => {
    const COLORS: Record<string, string> = {
      PIX: '#10b981',
      CREDIT_CARD: '#6366f1',
      DEBIT_CARD: '#f59e0b',
    };
    const config: ChartConfig = {};
    const items = distMetodo?.items ?? [];
    const data = items.map((item, i) => {
      const key = item.codigo.replace(/[^a-zA-Z0-9_-]/g, '_') || `slice_${i}`;
      config[key] = {
        label: item.nome,
        color: COLORS[item.codigo] ?? `hsl(${i * 100} 60% 50%)`,
      };
      return {
        chartKey: key,
        nome: item.nome,
        quantidade: item.quantidade,
        valor: item.valor,
        percentual: item.percentual,
        fill: `var(--color-${key})`,
      };
    });
    return { data, config };
  }, [distMetodo]);

  const isLoadingRelatorio =
    isLoadingConsolidadoProduto ||
    isLoadingPlataformaConsolidado ||
    isLoadingDash ||
    isLoadingSaquesPendentes ||
    (showSellerStats && isLoadingSellerStats);
  const fmt = formatBRL;
  // Receita e repasse vêm do mesmo endpoint e da mesma população de
  // transações. O consolidado geral tem regras próprias e pode excluir uma
  // venda que entra no relatório da plataforma.
  const detBruto =
    plataformaConsolidado?.receitaTotal ??
    plataformaDetalheProduto?.subtotalBruto ??
    0;
  // Derivados dos cards de breakdown (mesma fonte exibida na tela), para manter coerência:
  const totalTaxasDomVal = plataformaConsolidado?.totalTaxasDom ?? 0;
  const totalTaxasSimIntVal = plataformaConsolidado?.totalTaxasSimInt ?? 0;
  // Lucro líquido da SimIntPay = card "Receita Líquida - Sim Int Pay" (taxaSimIntPctNet), que já vem
  // do backend com o MDR da DOM e o fee fixo (R$1 + R$3 por transação) descontados.
  // Não usar `totalTaxasSimInt − totalTaxasDom`: totalTaxasSimInt já é líquido de MDR, então
  // essa subtração descontava o MDR duas vezes.
  const detLucro =
    plataformaConsolidado?.taxaSimIntPctNet ??
    totalTaxasSimIntVal - totalTaxasDomVal;
  // Repasse ao produto = soma direta do líquido de cada transação (backend), igual ao admin.
  // Fallback para a fórmula antiga (bruto − taxas) enquanto o backend novo não estiver no ar.
  const totalRepasseVal =
    plataformaConsolidado?.totalRepasse ?? detBruto - totalTaxasSimIntVal;
  // O backend calcula esta parcela na mesma base das linhas da tabela. Não
  // derive de bruto/repasse: esses dados podem vir de recortes distintos e gerar
  // cards divergentes.
  const taxaSimIntPercentualBruta =
    plataformaConsolidado?.taxaSimIntPctBruta ?? 0;

  if (isLoadingRelatorio) return <ReportSkeleton />;
  if (
    isPlataformaConsolidadoError ||
    dashboardError ||
    summaryError ||
    withdrawalsError ||
    (showSellerStats && sellersError) ||
    (plataformaConsolidado && 'error' in plataformaConsolidado)
  )
    return (
      <ReportError
        retry={() => {
          void retryBreakdown();
          void retryDashboard();
          void retrySummary();
          void retryWithdrawals();
          if (showSellerStats) void retrySellers();
        }}
      />
    );
  return (
    <div className="flex flex-col gap-8">
      {/* ── Período do produto ── */}
      <section>
        {!unified && (
          <>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
              Período do produto
            </p>
            <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/2">
              <div className="flex-1 min-w-[260px]">
                <DateRangePickerField
                  label="Data inicial e final:"
                  value={panelDateRange}
                  onChange={setPanelDateRange}
                  theme={fieldTheme}
                />
              </div>
              <div className="min-w-[160px]">
                <Dropdown
                  label="Método de pagamento:"
                  value={metodoPagamentoResumo}
                  onChange={setMetodoPagamentoResumo}
                  theme={fieldTheme}
                  variant="navbar"
                  options={[
                    { value: '', label: 'Todos' },
                    { value: 'PIX', label: 'Pix' },
                    { value: 'CREDIT_CARD', label: 'Crédito' },
                    { value: 'DEBIT_CARD', label: 'Débito' },
                  ]}
                />
              </div>
              <ActionButton variant="primary" onClick={handleAplicarPeriodo}>
                <Search className="h-4 w-4" />
                Aplicar
              </ActionButton>
            </div>
            {(periodoInicio || periodoFim) && (
              <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
                Período aplicado: {formatDateBR(periodoInicio)} a{' '}
                {formatDateBR(periodoFim)}
              </p>
            )}
          </>
        )}
        {isPlataformaConsolidadoError && (
          <div className="mt-3 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              <strong>Detalhamento DOM indisponível.</strong>{' '}
              {plataformaConsolidadoErrorMessage} Selecione um período de até 3
              meses.
            </p>
          </div>
        )}
      </section>

      {/* ── Resumo financeiro (Relatório por Produto) ── */}
      <section>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Resumo financeiro do período
        </p>
        {isLoadingRelatorio ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner size={24} className="text-zinc-400" />
          </div>
        ) : (
          <TooltipRadix.Provider delayDuration={200}>
            <div className="flex flex-col gap-8">
              {/* ── Visão Geral ── */}
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Visão Geral
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  <MetricCard
                    label="Total de transações"
                    value={String(plataformaConsolidado?.qtdTransacoes ?? 0)}
                    icon={Hash}
                  />
                  <MetricCard
                    label="Receita Total"
                    tooltip="Valor bruto de todas as transações aprovadas."
                    value={fmt(detBruto)}
                    valueClassName="text-emerald-600 dark:text-emerald-400"
                    icon={TrendingUp}
                    iconClassName="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400"
                  />
                  <MetricCard
                    label="Total de Repasse"
                    tooltip="Valor repassado ao cliente, deduzindo a taxa Sim Int Pay."
                    value={fmt(totalRepasseVal)}
                    valueClassName="text-cyan-600 dark:text-cyan-400"
                    icon={Banknote}
                    iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                  />
                </div>
                {/* ── DEBUG TEMPORÁRIO — descomentar quando precisar conferir o repasse ──
                <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 font-mono text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300">
                  <div className="font-bold">🔧 DEBUG (backend)</div>
                  <div>_v (versão do código): {String(plataformaConsolidado?._v ?? "❌ AUSENTE (backend antigo)")}</div>
                  <div>qtdTransacoes: {String(plataformaConsolidado?.qtdTransacoes ?? "—")} · qtdMaquineta: {String(plataformaConsolidado?.qtdMaquineta ?? "—")}</div>
                  <div>maqBruto: {fmt(plataformaConsolidado?.maqBruto ?? 0)} · maqNet: {fmt(plataformaConsolidado?.maqNet ?? 0)}</div>
                  <div>totalRepasse (backend): {plataformaConsolidado?.totalRepasse != null ? fmt(plataformaConsolidado.totalRepasse) : "❌ AUSENTE"}</div>
                  <div>detBruto: {fmt(detBruto)} · (antigo) bruto−taxas = {fmt(detBruto - totalTaxasSimIntVal)}</div>
                  <div className="font-bold">Repasse exibido = {fmt(totalRepasseVal)}</div>
                </div>
                ── fim DEBUG ── */}
              </section>

              {/* ── Taxas Sim Int Pay ── */}
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Taxas Sim Int Pay
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  <MetricCard
                    label="Taxa Percentual - Sim Int Pay"
                    tooltip="Valor cobrado em percentual dos nossos clientes."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(taxaSimIntPercentualBruta)
                    }
                    icon={TrendingUp}
                    iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                    valueClassName="text-violet-600 dark:text-violet-400"
                  />
                  <MetricCard
                    label="Taxa por Transação - Sim Int Pay"
                    tooltip="R$ 4 por transação cobrados pela Sim Int Pay."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.taxaSimIntFixa ?? 0)
                    }
                    icon={TrendingUp}
                    iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                    valueClassName="text-violet-600 dark:text-violet-400"
                  />
                  {
                    <MetricCard
                      label="Taxa de Saque — Simintpay"
                      tooltip={`Lucro com saques aprovados (${dashStats?.saqueFees?.quantidade ?? 0} saques). Clique para ver saque a saque.`}
                      value={
                        isLoadingDash
                          ? 'Carregando...'
                          : fmt(dashStats?.saqueFees?.lucroSimpay ?? 0)
                      }
                      valueClassName="text-violet-600 dark:text-violet-400"
                      icon={Wallet}
                      iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                      onAction={() => setShowSaquesModal(true)}
                      actionIcon={Eye}
                    />
                  }
                  <MetricCard
                    label="Receita Líquida - Sim Int Pay"
                    tooltip="Receita líquida da Sim Int Pay: o que sobra depois de pagar todos os custos da DOM (MDR percentual + R$ 1 por transação + R$ 3 de cashback)."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            plataformaConsolidado?.taxaSimIntPctNet ?? 0,
                          )
                    }
                    icon={TrendingUp}
                    iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                    valueClassName="text-violet-600 dark:text-violet-400"
                  />
                  {(tag === 'EBOOK' ||
                    tag === 'EBOOKSIM' ||
                    tag === 'REVALIDA') && (
                    <MetricCard
                      label="ROI"
                      tooltip="(Lucro Sim Int Pay + lucro de saque) ÷ receita bruta."
                      value={
                        detBruto > 0
                          ? `${(((detLucro + (dashStats?.saqueFees?.lucroSimpay ?? 0)) / detBruto) * 100).toFixed(2)}%`
                          : '—'
                      }
                      valueClassName="text-cyan-600 dark:text-cyan-400"
                      icon={TrendingUp}
                      iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                    />
                  )}
                  {(tag === 'RENOVADA' || tag === 'BOSQUE') && (
                    <MetricCard
                      label="ROI"
                      tooltip="(Lucro Sim Int Pay + lucro de saque) ÷ receita bruta."
                      value={
                        detBruto > 0
                          ? `${(((detLucro + (dashStats?.saqueFees?.lucroSimpay ?? 0)) / detBruto) * 100).toFixed(2)}%`
                          : '—'
                      }
                      valueClassName="text-cyan-600 dark:text-cyan-400"
                      icon={TrendingUp}
                      iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                    />
                  )}
                  {tag !== 'RENOVADA' &&
                    tag !== 'BOSQUE' &&
                    tag !== 'EBOOK' &&
                    tag !== 'EBOOKSIM' &&
                    tag !== 'REVALIDA' && (
                      <MetricCard
                        label="ROI"
                        tooltip="(Lucro Sim Int Pay + lucro de saque) ÷ receita bruta."
                        value={
                          detBruto > 0
                            ? `${(((detLucro + (dashStats?.saqueFees?.lucroSimpay ?? 0)) / detBruto) * 100).toFixed(2)}%`
                            : '—'
                        }
                        valueClassName="text-cyan-600 dark:text-cyan-400"
                        icon={TrendingUp}
                        iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                      />
                    )}
                  {tag === 'AREAFLIX' && (
                    <MetricCard
                      label="ROI Sim Int"
                      tooltip="Lucro de taxas ÷ receita bruta do produto."
                      value={
                        detBruto > 0
                          ? `${((detLucro / detBruto) * 100).toFixed(2)}%`
                          : '—'
                      }
                      valueClassName="text-cyan-600 dark:text-cyan-400"
                      icon={TrendingUp}
                      iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                    />
                  )}
                  {tag === 'AREAFLIX' && (
                    <MetricCard
                      label="ROI Produto"
                      tooltip="Repasse ao produto ÷ receita bruta."
                      value={
                        detBruto > 0
                          ? `${((totalRepasseVal / detBruto) * 100).toFixed(2)}%`
                          : '—'
                      }
                      valueClassName="text-indigo-600 dark:text-indigo-400"
                      icon={Percent}
                      iconClassName="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-400"
                    />
                  )}
                </div>
              </section>

              {/* ── Taxas DOM ── */}
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Taxas DOM
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  <MetricCard
                    label="Taxa Percentual - DOM"
                    tooltip="MDR percentual da DOM (varia por método e parcela)."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.taxaDomPct ?? 0)
                    }
                    icon={TrendingDown}
                    iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                    valueClassName="text-red-600 dark:text-red-400"
                  />
                  <MetricCard
                    label="Taxa por Transação - DOM"
                    tooltip="R$ 1 por transação cobrado pela DOM."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.taxaDomFixa ?? 0)
                    }
                    icon={TrendingDown}
                    iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                    valueClassName="text-red-600 dark:text-red-400"
                  />
                  <MetricCard
                    label="Taxa Cashback - DOM"
                    tooltip="R$ 3 por transação de cashback DOM."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.taxaDomCashback ?? 0)
                    }
                    icon={TrendingDown}
                    iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                    valueClassName="text-red-600 dark:text-red-400"
                  />
                  <MetricCard
                    label="Total de Taxas - DOM"
                    tooltip="Custo DOM total: MDR + R$ 1 + R$ 3 por transação."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.totalTaxasDom ?? 0)
                    }
                    icon={TrendingDown}
                    iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                    valueClassName="text-red-600 dark:text-red-400"
                  />
                </div>
              </section>

              {/* ── Parcelamento ── */}
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Parcelamento
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  <MetricCard
                    label="Valor Transacionado - Parcelamento"
                    tooltip="Valor bruto de todas as vendas aprovadas no cartão de crédito."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.parcBruto ?? 0)
                    }
                    icon={CreditCard}
                    iconClassName="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400"
                    valueClassName="text-emerald-600 dark:text-emerald-400"
                  />
                  <MetricCard
                    label="Taxa de Parcelamento Bruto"
                    tooltip="Todas as taxas DOM + todas as taxas Sim Int Pay do parcelamento."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            plataformaConsolidado?.taxaParcelamentoBruto ?? 0,
                          )
                    }
                    icon={CreditCard}
                    iconClassName="text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400"
                    valueClassName="text-amber-600 dark:text-amber-400"
                  />
                  <MetricCard
                    label="Parcelamento - DOM"
                    tooltip="Parte do parcelamento repassada à DOM."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            (plataformaConsolidado?.taxaParcelamentoBruto ??
                              0) -
                              (plataformaConsolidado?.taxaParcelamentoSimIntPay ??
                                0),
                          )
                    }
                    icon={CreditCard}
                    iconClassName="text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300"
                    valueClassName="text-rose-700 dark:text-rose-300"
                  />
                  <MetricCard
                    label="Parcelamento - Sim Int Pay"
                    tooltip="Valor líquido do parcelamento da Sim Int Pay."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(
                            plataformaConsolidado?.taxaParcelamentoSimIntPay ??
                              0,
                          )
                    }
                    icon={CreditCard}
                    iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                    valueClassName="text-violet-600 dark:text-violet-400"
                  />
                  <MetricCard
                    label="Total de Repasse - Parcelamento"
                    tooltip="Valor repassado ao cliente nas vendas no cartão de crédito."
                    value={
                      isLoadingPlataformaConsolidado
                        ? 'Carregando...'
                        : formatBRL(plataformaConsolidado?.parcRepasse ?? 0)
                    }
                    icon={Banknote}
                    iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                    valueClassName="text-cyan-600 dark:text-cyan-400"
                  />
                </div>
              </section>

              {/* ── Maquinetas (venda física / POS) ── */}
              {showMaquinetaCards && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Maquinetas
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    <MetricCard
                      label="Valor Transacionado - Maquineta"
                      tooltip={`Valor bruto de todas as vendas aprovadas na maquineta (${plataformaConsolidado?.qtdMaquineta ?? 0} transações).`}
                      value={
                        isLoadingPlataformaConsolidado
                          ? 'Carregando...'
                          : formatBRL(plataformaConsolidado?.maqBruto ?? 0)
                      }
                      icon={Smartphone}
                      iconClassName="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400"
                      valueClassName="text-emerald-600 dark:text-emerald-400"
                    />
                    <MetricCard
                      label="Custo total - DOM — Maquineta"
                      tooltip="Valor cobrado pela DOM nas vendas físicas (MDR da tabela POS + R$ 1 por transação no débito e no crédito)."
                      value={
                        isLoadingPlataformaConsolidado
                          ? 'Carregando...'
                          : formatBRL(plataformaConsolidado?.maqDom ?? 0)
                      }
                      icon={Smartphone}
                      iconClassName="text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300"
                      valueClassName="text-rose-700 dark:text-rose-300"
                    />
                    <MetricCard
                      label="Maquineta - Sim Int Pay"
                      tooltip="Valor cobrado do cliente pela Sim Int Pay nas vendas na maquineta."
                      value={
                        isLoadingPlataformaConsolidado
                          ? 'Carregando...'
                          : formatBRL(plataformaConsolidado?.maqSimInt ?? 0)
                      }
                      icon={Smartphone}
                      iconClassName="text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-400"
                      valueClassName="text-violet-600 dark:text-violet-400"
                    />
                    <MetricCard
                      label="Total de Repasse - Maquineta"
                      tooltip="Valor repassado ao cliente nas vendas na maquineta."
                      value={
                        isLoadingPlataformaConsolidado
                          ? 'Carregando...'
                          : formatBRL(plataformaConsolidado?.maqNet ?? 0)
                      }
                      icon={Banknote}
                      iconClassName="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400"
                      valueClassName="text-cyan-600 dark:text-cyan-400"
                    />
                  </div>
                </section>
              )}

              {
                <section className="flex flex-col gap-3">
                  <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Saques
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    <MetricCard
                      label="Saques Pendentes"
                      tooltip="Saques aguardando aprovação (geral da plataforma)."
                      value={
                        isLoadingSaquesPendentes
                          ? 'Carregando...'
                          : `${saquesPendentesData?.total ?? 0} pendentes`
                      }
                      valueClassName="text-orange-600 dark:text-orange-400"
                      icon={Clock}
                      iconClassName="text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400"
                    />
                  </div>
                </section>
              }

              {/* ── Contas — só renderiza quando a plataforma expõe stats de seller/cliente ── */}
              {showSellerStats && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Contas
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {showSellerStats &&
                      (tag === 'EBOOK' || tag === 'EBOOKSIM') && (
                        <MetricCard
                          label={contasLabel}
                          tooltip={contasTooltip}
                          value={
                            isLoadingSellerStats
                              ? 'Carregando...'
                              : `${sellerStats?.totalContas ?? 0} contas`
                          }
                          valueClassName="text-indigo-600 dark:text-indigo-400"
                          icon={BarChart3}
                          iconClassName="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-400"
                          onAction={() => {
                            setAllUsersPage(1);
                            setShowAllUsersModal(true);
                          }}
                          actionIcon={Eye}
                        />
                      )}
                    {showSellerStats &&
                      tag !== 'PAGATG' &&
                      tag !== 'EBOOKSIM' && (
                        <MetricCard
                          label={sellerLabel}
                          tooltip={sellerTooltip}
                          value={
                            isLoadingSellerStats
                              ? 'Carregando...'
                              : `${sellerStats?.sellersAtivos ?? 0} ${tag === 'AREAFLIX' ? 'ativos' : 'sellers'}`
                          }
                          valueClassName="text-sky-600 dark:text-sky-400"
                          icon={Users}
                          iconClassName="text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400"
                          onAction={() => {
                            setActiveSellersPage(1);
                            setShowActiveSellersModal(true);
                          }}
                          actionIcon={Eye}
                        />
                      )}
                    {showSellerStats &&
                      tag !== 'EBOOK' &&
                      tag !== 'EBOOKSIM' && (
                        <MetricCard
                          label={contasLabel}
                          tooltip={contasTooltip}
                          value={
                            isLoadingSellerStats
                              ? 'Carregando...'
                              : `${sellerStats?.totalContas ?? 0} ${tag === 'AREAFLIX' ? 'clientes' : 'contas'}`
                          }
                          valueClassName="text-indigo-600 dark:text-indigo-400"
                          icon={BarChart3}
                          iconClassName="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-400"
                          onAction={() => {
                            setAllUsersPage(1);
                            setShowAllUsersModal(true);
                          }}
                          actionIcon={Eye}
                        />
                      )}
                  </div>
                </section>
              )}

              {/* ── Estornos & Chargebacks ── */}
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Estornos & Chargebacks
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {tag !== 'RENOVADA' && tag !== 'BOSQUE' && (
                    <MetricCard
                      label="Estornos"
                      tooltip="Estornos no produto. Ícone alterna quantidade/valor."
                      value={
                        isLoadingDash
                          ? 'Carregando...'
                          : showEstornoValue
                            ? fmt(dashStats?.estornos?.valorLiquido ?? 0)
                            : `${dashStats?.estornos?.quantidade ?? 0} estornos`
                      }
                      valueClassName="text-rose-600 dark:text-rose-400"
                      icon={ShieldAlert}
                      iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
                      onAction={() => setShowEstornoValue((v) => !v)}
                      actionIcon={RefreshCw}
                    />
                  )}
                  {(tag === 'RENOVADA' || tag === 'BOSQUE') && (
                    <MetricCard
                      label="Estornos"
                      tooltip="Estornos no produto. Ícone alterna quantidade/valor."
                      value={
                        isLoadingDash
                          ? 'Carregando...'
                          : showEstornoValue
                            ? fmt(dashStats?.estornos?.valorLiquido ?? 0)
                            : `${dashStats?.estornos?.quantidade ?? 0} estornos`
                      }
                      valueClassName="text-rose-600 dark:text-rose-400"
                      icon={ShieldAlert}
                      iconClassName="text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400"
                      onAction={() => setShowEstornoValue((v) => !v)}
                      actionIcon={RefreshCw}
                    />
                  )}
                  {tag !== 'RENOVADA' && tag !== 'BOSQUE' && (
                    <MetricCard
                      label="Chargebacks"
                      tooltip="Chargebacks no produto. Ícone alterna quantidade/valor."
                      value={
                        isLoadingDash
                          ? 'Carregando...'
                          : showChargebackValue
                            ? fmt(dashStats?.chargebacks?.valorLiquido ?? 0)
                            : `${dashStats?.chargebacks?.quantidade ?? 0} chargebacks`
                      }
                      valueClassName="text-orange-600 dark:text-orange-400"
                      icon={AlertTriangle}
                      iconClassName="text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400"
                      onAction={() => setShowChargebackValue((v) => !v)}
                      actionIcon={RefreshCw}
                    />
                  )}
                  {(tag === 'RENOVADA' || tag === 'BOSQUE') && (
                    <MetricCard
                      label="Chargebacks"
                      tooltip="Chargebacks no produto. Ícone alterna quantidade/valor."
                      value={
                        isLoadingDash
                          ? 'Carregando...'
                          : showChargebackValue
                            ? fmt(dashStats?.chargebacks?.valorLiquido ?? 0)
                            : `${dashStats?.chargebacks?.quantidade ?? 0} chargebacks`
                      }
                      valueClassName="text-orange-600 dark:text-orange-400"
                      icon={AlertTriangle}
                      iconClassName="text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400"
                      onAction={() => setShowChargebackValue((v) => !v)}
                      actionIcon={RefreshCw}
                    />
                  )}
                </div>
              </section>
            </div>
          </TooltipRadix.Provider>
        )}
      </section>

      {/* ── Distribuição de pagamento ── */}
      <section>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Distribuição de pagamento
        </p>
        <div className="max-w-sm rounded-3xl border border-white/40 bg-white/70 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <div className="border-b border-zinc-200/70 px-4 py-3 dark:border-white/10">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                <ChartPie className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Distribuição por método
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Pix · Crédito · Débito — transações aprovadas
                </p>
              </div>
            </div>
          </div>
          <div className="flex min-h-[240px] flex-col items-center justify-center p-4">
            {isLoadingDistMetodo ? (
              <div className="flex h-[200px] w-full max-w-[220px] animate-pulse items-center justify-center rounded-full bg-zinc-200/50 dark:bg-white/10" />
            ) : distChartData.data.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Sem transações no período.
              </p>
            ) : (
              <ChartContainer
                config={distChartData.config}
                className="mx-auto aspect-square h-[min(240px,80vw)] w-full max-w-[240px]"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        nameKey="chartKey"
                        hideLabel
                        formatter={(value, _name, item) => {
                          const p = item?.payload as
                            | {
                                nome?: string;
                                percentual?: number;
                                valor?: number;
                              }
                            | undefined;
                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-muted-foreground">
                                {p?.nome ?? '—'}
                              </span>
                              <span className="font-mono font-medium tabular-nums">
                                {Number(value).toLocaleString('pt-BR')} (
                                {Number(p?.percentual ?? 0).toFixed(1)}%)
                              </span>
                              <span className="text-xs text-zinc-400">
                                {formatBRL(p?.valor)}
                              </span>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <Pie
                    data={distChartData.data}
                    dataKey="quantidade"
                    nameKey="chartKey"
                    innerRadius={48}
                    strokeWidth={2}
                    className="stroke-background"
                    isAnimationActive={false}
                  >
                    {distChartData.data.map((entry) => (
                      <Cell key={entry.chartKey} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartLegend
                    content={
                      <ChartLegendContent
                        nameKey="chartKey"
                        className="flex-wrap gap-x-3 gap-y-1"
                      />
                    }
                    className="-translate-y-2"
                  />
                </PieChart>
              </ChartContainer>
            )}
          </div>
        </div>
      </section>

      {/* Transações */}
      <section className="flex flex-col gap-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          Transações
        </p>

        {/* Filters */}
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/2">
          <div className="grid gap-3 md:grid-cols-3">
            <DateRangePickerField
              label="Data inicial e final:"
              value={txDateRange}
              onChange={setTxDateRange}
              theme={fieldTheme}
            />
            <Dropdown
              label="Status:"
              value={status}
              onChange={setStatus}
              theme={fieldTheme}
              variant="navbar"
              options={[
                { value: '', label: 'Todos' },
                { value: 'PENDING', label: 'Pendente' },
                { value: 'COMPLETED', label: 'Aprovado' },
                { value: 'FAILED', label: 'Recusado' },
                { value: 'REFUNDED', label: 'Estornado' },
                { value: 'EXPIRED', label: 'Expirado' },
              ]}
            />
            <Dropdown
              label="Método de pagamento:"
              value={metodoPagamentoTx}
              onChange={setMetodoPagamentoTx}
              theme={fieldTheme}
              variant="navbar"
              options={[
                { value: '', label: 'Todos' },
                { value: 'PIX', label: 'Pix' },
                { value: 'CREDIT_CARD', label: 'Crédito' },
                { value: 'DEBIT_CARD', label: 'Débito' },
              ]}
            />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Input
              label="Nome do comprador:"
              placeholder="Nome"
              value={compradorNome}
              onChange={setCompradorNome}
              theme={fieldTheme}
              variant="navbar"
            />
            <Input
              label="Documento:"
              placeholder="CPF/CNPJ"
              autoComplete="off"
              mask="cpf-cnpj"
              value={compradorDocumento}
              onChange={setCompradorDocumento}
              theme={fieldTheme}
              variant="navbar"
            />
            <Input
              label="E-mail:"
              placeholder="email@exemplo.com"
              value={compradorEmail}
              onChange={setCompradorEmail}
              theme={fieldTheme}
              variant="navbar"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {!isEbook && tag !== 'PAGATG' && tag !== 'REVALIDA' && (
              <div className="flex rounded-lg border border-zinc-200 bg-white p-1 dark:border-white/10 dark:bg-white/5">
                {[
                  { id: 'todos', label: 'Todos' },
                  { id: 'maquinetas', label: 'Maquinetas' },
                  { id: 'online', label: 'App' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTipoTransacao(t.id)}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${tipoTransacao === t.id ? 'bg-blue-600 text-white shadow-md' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <div className="ml-auto flex gap-2">
              <ActionButton variant="danger" onClick={handleClear}>
                <Eraser className="h-4 w-4" />
                Limpar
              </ActionButton>
            </div>
          </div>
        </div>

        <div className="relative z-0">
          <DataTable
            columns={columns}
            rows={txResponse?.data ?? []}
            loading={isLoadingTxs}
            page={txResponse?.page ?? 1}
            pageSize={txResponse?.pageSize ?? PAGE_SIZE}
            total={txResponse?.total ?? 0}
            onPageChange={(p) => setTxPage(p)}
            minWidth="min-w-[1000px]"
          />
        </div>
      </section>

      {/* ── Modal de usuários ativos ─────────────────────────────────────────── */}
      {showActiveSellersModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowActiveSellersModal(false)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {sellerLabel} — {tag}
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {activeSellersData?.total ?? 0}{' '}
                    {tag === 'AREAFLIX' ? 'assinantes' : 'sellers'} ativos
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowActiveSellersModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="Filtrar por nome, email ou CPF..."
                value={activeSellersSearch}
                onChange={(e) => setActiveSellersSearch(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:focus:border-sky-500 dark:focus:ring-sky-500/20"
              />
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto max-h-[65vh]">
              {isLoadingActiveSellers ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner className="h-6 w-6 text-sky-500" />
                </div>
              ) : !activeSellersData?.data.length ? (
                <p className="py-12 text-center text-xs text-zinc-400">
                  Nenhum usuário ativo encontrado.
                </p>
              ) : (
                (() => {
                  const q = activeSellersSearch.toLowerCase();
                  const filtered = activeSellersData.data.filter(
                    (u) =>
                      !q ||
                      u.name?.toLowerCase().includes(q) ||
                      u.email?.toLowerCase().includes(q) ||
                      u.cpf?.includes(q),
                  );
                  return filtered.length === 0 ? (
                    <p className="py-12 text-center text-xs text-zinc-400">
                      Nenhum resultado para &quot;{activeSellersSearch}&quot;.
                    </p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-100 dark:border-white/10">
                          <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                            Nome
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                            CPF
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                            Email
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                            Cadastro
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((u, i) => (
                          <tr
                            key={i}
                            className="border-b border-zinc-50 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5"
                          >
                            <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                              {u.name || '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400">
                              {u.cpf
                                ? u.cpf
                                    .replace(/\D/g, '')
                                    .replace(
                                      /(\d{3})(\d{3})(\d{3})(\d{2})/,
                                      '$1.$2.$3-$4',
                                    )
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                              {u.email || '—'}
                            </td>
                            <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                              {new Date(u.createdAt).toLocaleDateString(
                                'pt-BR',
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()
              )}
            </div>

            {/* Pagination */}
            {(activeSellersData?.total ?? 0) > 20 && (
              <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-white/10">
                <span className="text-xs text-zinc-400">
                  {activeSellersData?.total ?? 0} resultados · pág.{' '}
                  {activeSellersPage} de{' '}
                  {Math.ceil((activeSellersData?.total ?? 1) / 20)}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={activeSellersPage <= 1}
                    onClick={() => setActiveSellersPage((p) => p - 1)}
                    className="rounded-md border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-white/10"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={
                      activeSellersPage >=
                      Math.ceil((activeSellersData?.total ?? 1) / 20)
                    }
                    onClick={() => setActiveSellersPage((p) => p + 1)}
                    className="rounded-md border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-white/10"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal todos os usuários/clientes ─────────────────────────────────── */}
      {/* Modal: saques do período com a taxa cobrada em cada um */}
      {showSaquesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setShowSaquesModal(false)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Taxa de Saque — {tag}
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {saquesDetalhados?.quantidade ?? 0}{' '}
                    {(saquesDetalhados?.quantidade ?? 0) === 1
                      ? 'saque aprovado'
                      : 'saques aprovados'}
                    {periodoInicio && periodoFim
                      ? ` · ${formatDateBR(periodoInicio)} a ${formatDateBR(periodoFim)}`
                      : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSaquesModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[65vh]">
              {isLoadingSaquesDetalhados ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner className="h-6 w-6 text-violet-500" />
                </div>
              ) : !saquesDetalhados?.data?.length ? (
                <p className="py-12 text-center text-xs text-zinc-400">
                  Nenhum saque aprovado no período.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-white/10">
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        Aprovado em
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        Usuário
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                        Valor bruto
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                        Taxa cobrada
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                        Repassado
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {saquesDetalhados.data.map((sq) => (
                      <tr
                        key={sq.id}
                        className="border-b border-zinc-50 hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/5"
                      >
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {new Date(sq.aprovadoEm).toLocaleString('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                          <div className="truncate">{sq.usuario}</div>
                          {sq.email && (
                            <div className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                              {sq.email}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">
                          {fmt(sq.valorBruto)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-violet-600 dark:text-violet-400">
                          {fmt(sq.taxaCobrada)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">
                          {fmt(sq.valorLiquido)}
                        </td>
                        <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                          {SAQUE_STATUS_PT[sq.status] ?? sq.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {showAllUsersModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowAllUsersModal(false)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {contasLabel} — {tag}
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {allUsersData?.total ?? 0} usuários cadastrados
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAllUsersModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="Filtrar por nome, email ou CPF..."
                value={allUsersSearch}
                onChange={(e) => setAllUsersSearch(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/20"
              />
            </div>

            <div className="flex-1 overflow-y-auto max-h-[65vh]">
              {isLoadingAllUsers ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner className="h-6 w-6 text-indigo-500" />
                </div>
              ) : !allUsersData?.data.length ? (
                <p className="py-12 text-center text-xs text-zinc-400">
                  Nenhum usuário encontrado.
                </p>
              ) : (
                (() => {
                  const q = allUsersSearch.toLowerCase();
                  const filtered = allUsersData.data.filter(
                    (u) =>
                      !q ||
                      u.name?.toLowerCase().includes(q) ||
                      u.email?.toLowerCase().includes(q) ||
                      u.cpf?.includes(q),
                  );
                  return filtered.length === 0 ? (
                    <p className="py-12 text-center text-xs text-zinc-400">
                      Nenhum resultado para &quot;{allUsersSearch}&quot;.
                    </p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-100 dark:border-white/10">
                          <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                            Nome
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                            CPF
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                            Email
                          </th>
                          <>
                            <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                              Saldo Atribuído
                            </th>
                            <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                              Saldo Bloqueado
                            </th>
                          </>
                          <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                            Cadastro
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((u, i) => (
                          <tr
                            key={i}
                            className="border-b border-zinc-50 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5"
                          >
                            <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                              {u.name || '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400">
                              {u.cpf
                                ? u.cpf
                                    .replace(/\D/g, '')
                                    .replace(
                                      /(\d{3})(\d{3})(\d{3})(\d{2})/,
                                      '$1.$2.$3-$4',
                                    )
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                              {u.email || '—'}
                            </td>
                            <>
                              <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">
                                {u.balance === null ? (
                                  <span title="Histórico de atribuição incompleto ou carteira inconsistente; não representa saldo zero.">
                                    Indisponível
                                  </span>
                                ) : (
                                  u.balance.toLocaleString('pt-BR', {
                                    style: 'currency',
                                    currency: 'BRL',
                                  })
                                )}
                              </td>
                              <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">
                                {u.lockedBalance === null ? (
                                  <span title="Histórico de atribuição incompleto ou carteira inconsistente; não representa saldo zero.">
                                    Indisponível
                                  </span>
                                ) : (
                                  u.lockedBalance.toLocaleString('pt-BR', {
                                    style: 'currency',
                                    currency: 'BRL',
                                  })
                                )}
                              </td>
                            </>
                            <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                              {new Date(u.createdAt).toLocaleDateString(
                                'pt-BR',
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()
              )}
            </div>
            {(allUsersData?.total ?? 0) > 20 && (
              <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-white/10">
                <span className="text-xs text-zinc-400">
                  {allUsersData?.total ?? 0} resultados · pág. {allUsersPage} de{' '}
                  {Math.ceil((allUsersData?.total ?? 1) / 20)}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={allUsersPage <= 1}
                    onClick={() => setAllUsersPage((p) => p - 1)}
                    className="rounded-md border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-white/10"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={
                      allUsersPage >= Math.ceil((allUsersData?.total ?? 1) / 20)
                    }
                    onClick={() => setAllUsersPage((p) => p + 1)}
                    className="rounded-md border border-zinc-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-white/10"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main section ──────────────────────────────────────────────────────────────

type Props = {
  effectiveDateRange: DateRange;
  /**
   * Qual visão renderizar. Controlado pelas abas do topo da página
   * (Relatório Financeiro / Relatório por Produto / Saldos por Plataforma) —
   * o componente não tem mais sub-abas próprias.
   */
  view?: 'relatorio' | 'saldos';
  platform?: ReportPlatform;
  method?: string;
};

function formatDateBR(ymd: string | undefined | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

export function ProdutoReportSection({
  effectiveDateRange,
  view = 'relatorio',
  platform,
  method = 'all',
}: Props) {
  const [selected, setSelected] = useState<ReportPlatform | null>(null);
  const current = platform ?? selected;
  const selectedTag = current?.tag ?? null;
  // Only presentation is tag-specific. Existence and names come from the database catalog.
  const config = PRODUTOS_BASE.find(
    (p) => consolidadoTagFor(p.tag) === consolidadoTagFor(selectedTag ?? ''),
  );
  const produtoAtual = current
    ? {
        ...config,
        tag: current.tag,
        label: current.name,
        icon: config?.icon ?? 'building',
        accent: config?.accent ?? '#7c3aed',
      }
    : null;

  const dataInicio = formatQueryDate(effectiveDateRange.start);
  const dataFim = formatQueryDate(effectiveDateRange.end);

  return (
    <div className="flex flex-col gap-5">
      {/* Header — só na visão de produto; PlatformBalancesView já traz o próprio título. */}
      {!platform && view !== 'saldos' && (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-white/5">
            <Package className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Relatório por Produto
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Selecione um produto para ver métricas, dados do relatório
              consolidado e transações.
            </p>
          </div>
        </div>
      )}

      {view === 'saldos' ? (
        <PlatformBalancesView />
      ) : (
        <>
          {!platform && (
            <ReportPlatformSelect value={selected} onChange={setSelected} />
          )}

          {/* Panel */}
          {selectedTag && produtoAtual && (
            <div
              className="rounded-3xl border bg-white shadow-sm dark:bg-zinc-900/40"
              style={{ borderColor: `${produtoAtual.accent}30` }}
            >
              {/* Panel header */}
              <div
                className="flex items-center gap-3 border-b p-6"
                style={{ borderColor: `${produtoAtual.accent}20` }}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-2xl"
                  style={{ background: `${produtoAtual.accent}18` }}
                >
                  {produtoAtual.icon === 'tv' ? (
                    <Tv
                      className="h-5 w-5"
                      style={{ color: produtoAtual.accent }}
                    />
                  ) : (
                    <Building2
                      className="h-5 w-5"
                      style={{ color: produtoAtual.accent }}
                    />
                  )}
                </div>
                <div>
                  <h3
                    className="text-lg font-black uppercase tracking-tight"
                    style={{ color: produtoAtual.accent }}
                  >
                    {produtoAtual.label}
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500">
                    Dashboard + relatório consolidado + transações ·{' '}
                    {dataInicio && dataFim
                      ? `${formatDateBR(dataInicio)} a ${formatDateBR(dataFim)}`
                      : 'período filtrado'}
                  </p>
                </div>
              </div>

              <div className="p-6">
                {!config ||
                (method !== 'all' &&
                  ['AREAFLIX', 'ATLAS'].includes(selectedTag)) ? (
                  <OwnedReportContent
                    filters={{
                      platform: selectedTag,
                      startDate: dataInicio,
                      endDate: dataFim,
                      paymentMethod: method === 'all' ? undefined : method,
                    }}
                    product
                  />
                ) : selectedTag === 'AREAFLIX' ? (
                  <AreaflixPanel
                    dashDataInicio={dataInicio}
                    dashDataFim={dataFim}
                  />
                ) : selectedTag === 'ATLAS' ? (
                  <AtlasPanel
                    dashDataInicio={dataInicio}
                    dashDataFim={dataFim}
                  />
                ) : (
                  <GenericPlatformPanel
                    key={`${selectedTag}:${dataInicio}:${dataFim}:${method}`}
                    unified
                    initialMethod={method === 'all' ? '' : method}
                    tag={selectedTag}
                    accent={produtoAtual.accent}
                    isEbook={
                      selectedTag === 'EBOOK' || selectedTag === 'EBOOKSIM'
                    }
                    dashDataInicio={dataInicio}
                    dashDataFim={dataFim}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
