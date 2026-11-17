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
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Percent,
  Package,
  Search,
  Eraser,
  QrCode,
  Users,
  Banknote,
  Clock,
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
import { DataTable } from '@/components/ui/DataTable';
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
import {
  consolidadoTagFor,
  findPlataformaDetalheByTag,
} from '@/lib/consolidado-tag';
import { MetricCard } from './MetricCard';
import { ActionButton } from './ActionButton';
import { DateRangePickerField } from './DateRangePickerField';
import type { DateRange } from '../types';
import type { Plataforma as PlataformaDetalhe } from './LucroSimpayDetalhePanel';
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
      {/* Header — só na visão de produto. */}
      {!platform && (
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
              ['AREAFLIX', 'ATLAS'].includes(consolidadoTagFor(selectedTag)) ? (
                <OwnedReportContent
                  filters={{
                    platform: selectedTag,
                    startDate: dataInicio,
                    endDate: dataFim,
                    paymentMethod: method === 'all' ? undefined : method,
                  }}
                  product
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
    </div>
  );
}
