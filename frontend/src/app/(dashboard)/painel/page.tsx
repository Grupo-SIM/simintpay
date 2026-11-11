'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTheme } from 'next-themes';
import BetaiDashboard from './betai-dashboard';
import { loadOwnedDashboard } from './utils/owned-dashboard';
import type {
  ReportPage,
  ReportSummary,
} from '../relatorio/components/report-types';
import { DashboardPageSkeleton } from '../components/DashboardPageSkeleton';
import { useCurrentUser } from '@/hooks/use-current-user';
import { cn, isNegativeMoneyString } from '@/lib/utils';
import { DateRangePickerField } from '@/app/(dashboard)/relatorio/components/DateRangePickerField';
import type { DateRange } from '@/app/(dashboard)/relatorio/types';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Cell,
} from 'recharts';
import { LoadingOverlay } from '@/components/ui/Loading';
import { Modal } from '@/components/ui/Modal';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { applyLucroSimpayDetalheConsolidadoMerges } from '@/app/(dashboard)/relatorio/utils/consolidadoLucroMerge';
import type { LucroSimpayDetalhe } from '@/app/(dashboard)/relatorio/components/LucroSimpayDetalhePanel';
import type { Saque } from '@/features/saques/types/saques.types';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  ArrowUpRight,
  RefreshCw,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CreditCard,
  BarChart3,
  Smartphone,
  HelpCircle,
} from 'lucide-react';
import { Tooltip as TooltipRadix } from 'radix-ui';
import type { CSSProperties, ReactNode } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type Period = 'ontem' | 'hoje' | '7dias' | '15dias' | '30dias';

const CONSOLIDADO_PERIOD_TYPE = 'settlement' as const;
const CONSOLIDADO_TX_TYPE = 'all' as const;

function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Resposta do consolidado: `{ ... }`, `{ data: { ... } }` ou duplo `data`. */
function unwrapConsolidadoPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const looksLikePayload = (o: Record<string, unknown>) =>
    'lucroTotalMaster' in o ||
    'valorBruto' in o ||
    'lucroTotalMasterHistorico' in o ||
    'dashboardFinanceHistorico' in o ||
    'lucroSimpayDetalhe' in o ||
    'lucroSimpay' in o;

  const d = r.data;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const inner = d as Record<string, unknown>;
    if (looksLikePayload(inner)) return inner;
    const d2 = inner.data;
    if (d2 && typeof d2 === 'object' && !Array.isArray(d2)) {
      const inner2 = d2 as Record<string, unknown>;
      if (looksLikePayload(inner2)) return inner2;
    }
  }
  return r;
}

/** BFF às vezes aninha `dashboardFinanceHistorico` fora do objeto já “achatado”. */
function extractDashboardFinanceHistorico(raw: unknown): unknown[] | undefined {
  const walk = (obj: unknown, depth: number): unknown[] | undefined => {
    if (depth > 10 || !obj || typeof obj !== 'object' || Array.isArray(obj))
      return undefined;
    const o = obj as Record<string, unknown>;
    for (const key of [
      'dashboardFinanceHistorico',
      'dashboard_finance_historico',
    ] as const) {
      const v = o[key];
      if (Array.isArray(v) && v.length > 0) return v;
    }
    for (const v of Object.values(o)) {
      const found = walk(v, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return walk(raw, 0);
}

/** Valor no gráfico master: mantém prejuízo (negativo), só arredonda. */
function masterChartPointValue(raw: unknown): number {
  const v = Number(raw ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Number(v.toFixed(2));
}

/** Série horária real do backend: 24 pontos com rótulos 00h…23h. */
function isLucroMasterHistoricoPorHoraValido(
  rows: unknown,
): rows is Array<Record<string, unknown>> {
  if (!Array.isArray(rows) || rows.length !== 24) return false;
  const seen = new Set<number>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') return false;
    const label = String((row as Record<string, unknown>).label ?? '');
    const m = /^(\d{2})h$/.exec(label);
    if (!m) return false;
    const h = parseInt(m[1], 10);
    if (h < 0 || h > 23) return false;
    seen.add(h);
  }
  return seen.size === 24;
}

function hourInAmericaSaoPaulo(isoDate: string): number {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 0;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const v = parts.find((p) => p.type === 'hour')?.value;
  const n = parseInt(v ?? '0', 10);
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : 0;
}

/** Agrega lucro Simpay por hora a partir de `detalharLucro` (transações elegíveis). */
function buildLucroMasterChartFromLucroSimpayDetalhe(detalhe: unknown): Array<{
  label: string;
  online: number;
  physical: number;
}> {
  const buckets = new Array(24).fill(0) as number[];
  if (!detalhe || typeof detalhe !== 'object') {
    return buckets.map((_, h) => ({
      label: `${String(h).padStart(2, '0')}h`,
      online: 0,
      physical: 0,
    }));
  }
  const plats = (detalhe as Record<string, unknown>).plataformas;
  if (!Array.isArray(plats)) {
    return buckets.map((_, h) => ({
      label: `${String(h).padStart(2, '0')}h`,
      online: 0,
      physical: 0,
    }));
  }
  for (const p of plats) {
    if (!p || typeof p !== 'object') continue;
    const txs = (p as Record<string, unknown>).transacoes;
    if (!Array.isArray(txs)) continue;
    for (const tx of txs) {
      if (!tx || typeof tx !== 'object') continue;
      const t = tx as Record<string, unknown>;
      const createdAt = t.createdAt;
      if (typeof createdAt !== 'string') continue;
      const lucro = Number(t.lucroTransacao ?? 0);
      if (!Number.isFinite(lucro)) continue;
      const hour = hourInAmericaSaoPaulo(createdAt);
      buckets[hour] += lucro;
    }
  }
  return buckets.map((v, h) => ({
    label: `${String(h).padStart(2, '0')}h`,
    online: masterChartPointValue(v),
    physical: 0,
  }));
}

function listDaysInclusive(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cur = startOfDayLocal(start);
  const last = startOfDayLocal(end);
  while (cur <= last) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Intervalo inclusivo [start, end] por dia local, alinhado aos botões do painel. */
function periodToInclusiveRange(period: Period): { start: Date; end: Date } {
  const end = startOfDayLocal(new Date());
  switch (period) {
    case 'ontem': {
      const s = new Date(end);
      s.setDate(s.getDate() - 1);
      return { start: s, end: s };
    }
    case 'hoje':
      return { start: end, end };
    case '7dias': {
      const s = new Date(end);
      s.setDate(s.getDate() - 6);
      return { start: startOfDayLocal(s), end };
    }
    case '15dias': {
      const s = new Date(end);
      s.setDate(s.getDate() - 14);
      return { start: startOfDayLocal(s), end };
    }
    case '30dias': {
      const s = new Date(end);
      s.setDate(s.getDate() - 29);
      return { start: startOfDayLocal(s), end };
    }
  }
}

type DashboardData = {
  user?: { name?: string | null };
  summary?: {
    withdrawalsInAnalysis?: number;
    availableBalance?: number;
    balanceInProcessing?: number;
    globalRetention?: number;
    financialReserve?: number;
    disputedTransactions?: number;
    blockedBalance?: number;
  };
  transactionsByPeriod?: {
    totalSales?: number;
    paidTransactions?: number;
    approvalRate?: number;
    averageTicket?: number;
    installmentInterest?: number;
    onlineSalesRate?: number;
    physicalSalesRate?: number;
    chartData?: Array<
      | { label: string; online: number; physical: number }
      | AdminFinanceChartPoint
    >;
    _adminFinanceMulti?: boolean;
    _adminFinanceSingleDay?: boolean;
  };
  paymentMethods?: {
    offers?: { percentage: number; amount: number };
    maquinetas?: { percentage: number; amount: number };
    boleto?: { percentage: number; amount: number };
    debit?: { percentage: number; amount: number };
    credit?: { percentage: number; amount: number };
    pix?: { percentage: number; amount: number };
  };
  chargebacks?: {
    totalRefunded?: number;
    chargebackNotifications?: number;
    refunds?: { count: number; amount: number };
    chargebackPrevention?: { count: number; amount: number };
    chargebacks?: { count: number; amount: number };
  };
  installments?: {
    data?: Array<{ installments: number; amount: number; count: number }>;
  };
  /** Painel admin: métricas derivadas do consolidado (lucroTotalMaster). */
  _adminMaster?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBRL(value: number | undefined | null) {
  const v = Number(value ?? 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtPct(value?: number | null): string {
  return `${(value ?? 0).toFixed(2)}%`;
}

function formatDateBR(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function BlurValue({
  value,
  show,
  className = '',
}: {
  value: import('react').ReactNode;
  show: boolean;
  className?: string;
}) {
  // Valor monetário negativo → vermelho (saldo/lucro negativo em qualquer card do painel).
  const neg = isNegativeMoneyString(typeof value === 'string' ? value : '');
  return (
    <span
      className={cn(
        !show ? 'privacy-blur' : '',
        className,
        neg && 'text-red-600 dark:text-red-400',
      )}
      style={{
        display: 'inline-block',
        transition: 'filter 0.3s ease',
      }}
    >
      {value}
    </span>
  );
}

function DashboardStatTooltip({ content }: { content: ReactNode }) {
  return (
    <TooltipRadix.Root delayDuration={200}>
      <TooltipRadix.Trigger asChild>
        <button
          type="button"
          aria-label="Explicação deste indicador"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--painel-help-bg)',
            border: '1px solid var(--painel-help-border)',
            borderRadius: 8,
            padding: '4px 5px',
            cursor: 'help',
            color: 'var(--painel-help-icon)',
          }}
        >
          <HelpCircle size={14} />
        </button>
      </TooltipRadix.Trigger>
      <TooltipRadix.Portal>
        <TooltipRadix.Content
          side="top"
          align="end"
          sideOffset={8}
          style={{
            maxWidth: 300,
            padding: '12px 14px',
            borderRadius: 12,
            background: 'var(--painel-radix-tooltip-bg)',
            border: '1px solid var(--painel-radix-tooltip-border)',
            color: 'var(--painel-radix-tooltip-fg)',
            fontSize: 12,
            lineHeight: 1.5,
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
            zIndex: 200,
          }}
        >
          {content}
        </TooltipRadix.Content>
      </TooltipRadix.Portal>
    </TooltipRadix.Root>
  );
}

// ── Chart config ───────────────────────────────────────────────────────────────

const salesChartConfig = {
  online: { label: 'Vendas on-line', color: '#7c3aed' },
  physical: { label: 'Vendas físicas', color: '#3b82f6' },
} satisfies ChartConfig;

/** Dashboard admin master: série do consolidado (GET retorna `dashboardFinanceHistorico`). */
const adminFinanceChartConfig = {
  valorBruto: { label: 'Receita total', color: '#22c55e' },
  taxaSimInt: { label: 'Taxa Sim Int Pay', color: '#f43f5e' },
  taxaServico: { label: 'Taxa de transação - Sim Int Pay', color: '#14b8a6' },
  taxaAdquirente: { label: 'Taxa adquirente', color: '#fb923c' },
  taxaSaque: { label: 'Taxa de saque adquirente', color: '#f97316' },
  lucroSaque: { label: 'Lucro de saque', color: '#e11d48' },
  lucroSimpay: { label: 'Receita Líquida', color: '#a78bfa' },
} satisfies ChartConfig;

type AdminFinanceChartPoint = {
  label: string;
  valorBruto: number;
  valorLiquido: number;
  lucroSimpay: number;
  taxaServico: number;
  taxaAdquirente: number;
  taxaSaque: number;
  lucroSaque: number;
  taxaSimInt: number;
};

const ADMIN_FINANCE_KEYS = [
  'valorBruto',
  'taxaSimInt',
  'taxaServico',
  'taxaAdquirente',
  'taxaSaque',
  'lucroSaque',
  'lucroSimpay',
] as const;

const PIE_COLORS = {
  offers: '#7c3aed',
  maquinetas: '#3b82f6',
};

// ── Design tokens ──────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--painel-card-bg)',
  border: '1px solid var(--painel-card-border)',
  borderRadius: 16,
};

const cardPad: React.CSSProperties = { ...card, padding: 20 };

// ── Period buttons ─────────────────────────────────────────────────────────────

const PERIODS: { key: Period; label: string }[] = [
  { key: 'ontem', label: 'Ontem' },
  { key: 'hoje', label: 'Hoje' },
  { key: '7dias', label: '7 dias' },
  { key: '15dias', label: '15 dias' },
  { key: '30dias', label: '30 dias' },
];

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  color = 'purple',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  color?: 'purple' | 'blue';
}) {
  const bg = checked
    ? color === 'purple'
      ? '#7c3aed'
      : '#3b82f6'
    : 'var(--painel-toggle-off)';
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        width: 34,
        height: 18,
        borderRadius: 999,
        border: 'none',
        background: bg,
        cursor: 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: checked ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}

// ── Chargeback progress row ────────────────────────────────────────────────────

function CBRow({
  label,
  count,
  amount,
  maxCount,
}: {
  label: string;
  count: number;
  amount: number;
  maxCount: number;
}) {
  const pct = maxCount > 0 ? Math.min((count / maxCount) * 100, 100) : 0;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 5,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--painel-muted)' }}>
          {label}:{' '}
          <span style={{ color: 'var(--painel-muted-2)' }}>
            {count} transações
          </span>
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--painel-fg-strong)',
          }}
        >
          {formatBRL(amount)}
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: 'var(--painel-bar-track)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: '#7c3aed',
            borderRadius: 999,
            transition: 'width 0.5s',
          }}
        />
      </div>
    </div>
  );
}

// ── Payment method row (right panel) ──────────────────────────────────────────

function PMRow({
  label,
  amount,
  pct,
  color,
  up,
}: {
  label: string;
  amount: number;
  pct: number;
  color: string;
  up: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        borderBottom: '1px solid var(--painel-cb-row-border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            flexShrink: 0,
            display: 'block',
          }}
        />
        <div>
          <p
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--painel-fg-strong)',
              lineHeight: 1.2,
            }}
          >
            {label}
          </p>
          <p
            style={{
              fontSize: 11,
              color: 'var(--painel-subtle)',
              lineHeight: 1.2,
            }}
          >
            {formatBRL(amount)}
          </p>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 12,
          fontWeight: 600,
          color: up ? '#10b981' : '#ef4444',
        }}
      >
        {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {fmtPct(pct)}
      </div>
    </div>
  );
}

type PlatformPeriod = {
  total?: number;
  offersPct?: number;
  maquinetasPct?: number;
  offers?: number;
  maquinetas?: number;
  taxaServicoSimPay?: number;
  taxaSaque?: number;
  lucroSaque?: number;
};
type PlatformRefund = {
  quantidade?: number;
  valorLiquido?: number;
  valor?: number;
  total?: number;
} & Record<
  string,
  | {
      quantidade?: number;
      count?: number;
      valorLiquido?: number;
      valor?: number;
      netAmount?: number;
      amount?: number;
    }
  | number
  | undefined
>;
type PlatformDashboard = {
  selected?: {
    profit?: PlatformPeriod;
    estornos?: PlatformRefund;
    chargebacks?: PlatformRefund;
  };
  estornos?: PlatformRefund;
  chargebacks?: PlatformRefund;
  summary?: { availableBalance?: number; balanceInProcessing?: number };
  profit?: PlatformPeriod & {
    yesterday?: PlatformPeriod;
    today?: PlatformPeriod;
    sevenDays?: PlatformPeriod;
    fifteenDays?: PlatformPeriod;
    thirtyDays?: PlatformPeriod;
    charts?: {
      selectedRange?: {
        label?: string;
        offers?: number;
        maquinetas?: number;
      }[];
      last30Days?: { label?: string; offers?: number; maquinetas?: number }[];
    };
  };
};

/** Estornos da Renovada no mesmo recorte do período (`selected` alinha ao filtro de datas). */
function pickRenovadaEstornos(res: PlatformDashboard) {
  if (
    res?.selected &&
    res.selected.estornos != null &&
    typeof res.selected.estornos === 'object'
  ) {
    const sel = res.selected.estornos;
    return {
      quantidade: Number(sel.quantidade ?? 0),
      valorLiquido: Number(sel.valorLiquido ?? sel.valor ?? 0),
    };
  }
  const root = res?.estornos;
  return {
    quantidade: Number(root?.quantidade ?? 0),
    valorLiquido: Number(root?.valorLiquido ?? root?.valor ?? 0),
  };
}

/** Chargebacks da Renovada no mesmo recorte do período. */
function pickRenovadaChargebacks(res: PlatformDashboard) {
  if (
    res?.selected &&
    res.selected.chargebacks != null &&
    typeof res.selected.chargebacks === 'object'
  ) {
    const sel = res.selected.chargebacks;
    return {
      quantidade: Number(sel.quantidade ?? 0),
      valorLiquido: Number(sel.valorLiquido ?? sel.valor ?? 0),
    };
  }
  const root = res?.chargebacks;
  return {
    quantidade: Number(root?.quantidade ?? 0),
    valorLiquido: Number(root?.valorLiquido ?? root?.valor ?? 0),
  };
}

/** Estornos da Revalida por período (estrutura espelhando profit.*) ou fallback no objeto raiz. */
function pickRevalidaEstornos(res: PlatformDashboard, period: Period) {
  const e = res?.estornos;
  if (!e || typeof e !== 'object') {
    return { quantidade: 0, valorLiquido: 0 };
  }
  const periodKeys: Record<Period, string[]> = {
    ontem: ['yesterday', 'ontem'],
    hoje: ['today', 'hoje'],
    '7dias': ['sevenDays', 'seven_days', '7dias'],
    '15dias': ['fifteenDays', 'fifteen_days', '15dias'],
    '30dias': ['thirtyDays', 'thirty_days', '30dias'],
  };
  for (const k of periodKeys[period]) {
    const chunk = e[k];
    if (chunk && typeof chunk === 'object') {
      const q = chunk.quantidade ?? chunk.count;
      const v = chunk.valorLiquido ?? chunk.valor ?? chunk.amount;
      if (q != null || v != null) {
        return { quantidade: Number(q ?? 0), valorLiquido: Number(v ?? 0) };
      }
    }
  }
  return {
    quantidade: Number(e.quantidade ?? 0),
    valorLiquido: Number(e.valorLiquido ?? e.valor ?? 0),
  };
}

// ── Revalida data mapper ────────────────────────────────────────────────────────

function mapRevalidaData(
  res: PlatformDashboard,
  period: Period,
  userName?: string | null,
) {
  const est = pickRevalidaEstornos(res, period);
  const periodProfit: Record<Period, number> = {
    ontem: res.profit?.yesterday?.total ?? 0,
    hoje: res.profit?.today?.total ?? 0,
    '7dias': res.profit?.sevenDays?.total ?? 0,
    '15dias': res.profit?.fifteenDays?.total ?? 0,
    '30dias': res.profit?.thirtyDays?.total ?? 0,
  };
  return {
    user: { name: userName },
    summary: {
      availableBalance: res.summary?.availableBalance ?? 0,
      balanceInProcessing: 0,
      financialReserve: 0,
      withdrawalsInAnalysis: 0,
    },
    transactionsByPeriod: {
      totalSales: periodProfit[period] ?? 0,
      paidTransactions: 0,
      approvalRate: 100,
      averageTicket: 0,
      onlineSalesRate: 100,
      physicalSalesRate: 0,
      chartData: (res.profit?.charts?.last30Days ?? []).map(
        (p: { label?: string; value?: number; total?: number }) => ({
          label: p.label ?? '',
          online: Number(p.value ?? 0),
          physical: 0,
        }),
      ),
    },
    chargebacks: {
      totalRefunded: est.valorLiquido,
      chargebackNotifications: 0,
      refunds: { count: est.quantidade, amount: est.valorLiquido },
      chargebackPrevention: { count: 0, amount: 0 },
      chargebacks: { count: 0, amount: 0 },
    },
  };
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PainelPage() {
  const { user: currentUser } = useCurrentUser();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';
  const [activeTab, setActiveTab] = useState<
    'simintpay' | 'betai' | 'futura-adquirente'
  >('simintpay');
  const [isLoading, setIsLoading] = useState(true);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const dashboardRequest = useRef(0);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('30dias');
  const [showBalances, setShowBalances] = useState(true);
  const [showOnline, setShowOnline] = useState(true);
  const [showPhysical, setShowPhysical] = useState(true);
  const [adminFinSeries, setAdminFinSeries] = useState<
    Record<(typeof ADMIN_FINANCE_KEYS)[number], boolean>
  >({
    valorBruto: true,
    taxaSimInt: true,
    taxaServico: true,
    taxaAdquirente: true,
    taxaSaque: true,
    lucroSaque: true,
    lucroSimpay: true,
  });
  const hasLoadedOnce = useRef(false);
  const [customRange, setCustomRange] = useState<DateRange>({
    start: null,
    end: null,
  });

  const [quickStats, setQuickStats] = useState<{
    transacoesHoje: number | null;
    saquesPendentesCount: number | null;
    saquesPendentesValor: number | null;
    receitaMensalLiquida: number | null;
  }>({
    transacoesHoje: null,
    saquesPendentesCount: null,
    saquesPendentesValor: null,
    receitaMensalLiquida: null,
  });
  const [isLoadingQuickStats, setIsLoadingQuickStats] = useState(false);
  const [pendingSaques, setPendingSaques] = useState<Saque[]>([]);
  const [adminSaqueModalOpen, setAdminSaqueModalOpen] = useState(false);
  const [adminSaqueActionType, setAdminSaqueActionType] = useState<
    'APPROVE' | 'REJECT'
  >('APPROVE');
  const [adminSaqueSelected, setAdminSaqueSelected] = useState<Saque | null>(
    null,
  );
  const [adminSaqueRejectReason, setAdminSaqueRejectReason] = useState('');
  const [adminSaqueActionError, setAdminSaqueActionError] = useState<
    string | null
  >(null);
  const [isAdminSaqueSaving, setIsAdminSaqueSaving] = useState(false);

  const isRenovada =
    currentUser?.tenantModule?.slug?.toLowerCase().includes('renovada') ||
    currentUser?.modulo?.slug?.toLowerCase().includes('renovada') ||
    currentUser?.email?.toLowerCase().includes('renovada');

  const isBosque =
    currentUser?.tenantModule?.slug?.toLowerCase().includes('bosque') ||
    currentUser?.modulo?.slug?.toLowerCase().includes('bosque') ||
    currentUser?.email?.toLowerCase().includes('bosque');

  /** Painel plataforma (mesma API que /admin/plataformas/:tag/dashboard): Renovada ou Bosque. */
  const painelPlataformaTag = isRenovada
    ? 'renovada'
    : isBosque
      ? 'bosque'
      : null;

  const isRevalida =
    currentUser?.tenantModule?.slug?.toLowerCase().includes('revalida') ||
    currentUser?.modulo?.slug?.toLowerCase().includes('revalida') ||
    currentUser?.email?.toLowerCase().includes('revalida');

  const isAdmin = Boolean(currentUser?.isAdmin);
  const isOwnedDashboard = !isAdmin && !painelPlataformaTag && !isRevalida;

  const dashboardScope = `${currentUser?.id ?? ''}:${isAdmin}:${painelPlataformaTag ?? ''}:${isRevalida}:${selectedPeriod}:${customRange.start?.getTime() ?? ''}:${customRange.end?.getTime() ?? ''}`;
  const [previousDashboardScope, setPreviousDashboardScope] =
    useState(dashboardScope);
  if (previousDashboardScope !== dashboardScope) {
    setPreviousDashboardScope(dashboardScope);
    setDashboardError(null);
    if (!dashboardData) setIsLoading(true);
    else setIsChartLoading(true);
  }
  const [previousStatsUser, setPreviousStatsUser] = useState(currentUser?.id);
  if (previousStatsUser !== currentUser?.id) {
    setPreviousStatsUser(currentUser?.id);
    setIsLoadingQuickStats(Boolean(currentUser));
  }

  const fetchData = useCallback(
    async (period: Period, overrideRange?: { start: Date; end: Date }) => {
      if (!currentUser) return;
      const request = ++dashboardRequest.current;

      const load = async () => {
        const token =
          typeof window !== 'undefined'
            ? (localStorage.getItem('access_token') ?? undefined)
            : undefined;
        const api = createApiClient({
          baseUrl: getDefaultApiBaseUrl(),
          getToken: () => token,
        });

        let data;

        if (isAdmin) {
          const range = overrideRange ?? periodToInclusiveRange(period);
          const queryRange = {
            periodType: CONSOLIDADO_PERIOD_TYPE,
            dataInicio: formatYmd(range.start),
            dataFim: formatYmd(range.end),
            transactionType: CONSOLIDADO_TX_TYPE,
          };
          const resRaw = await api.get<unknown>(
            endpoints.relatorios.consolidado,
            {
              query: queryRange,
            },
          );
          const res = unwrapConsolidadoPayload(resRaw);

          const historico =
            res.lucroTotalMasterHistorico ??
            res.lucroTotalMasterPorDia ??
            res.serieLucroTotalMaster;
          const financeHistRaw = res.dashboardFinanceHistorico;
          const financeHist =
            Array.isArray(financeHistRaw) && financeHistRaw.length > 0
              ? financeHistRaw
              : extractDashboardFinanceHistorico(resRaw);
          let chartData: Array<
            | { label: string; online: number; physical: number }
            | AdminFinanceChartPoint
          > = [];
          let adminFinanceMulti = false;

          const daysInRange = listDaysInclusive(range.start, range.end);
          const singleCalendarDay = daysInRange.length === 1;

          if (Array.isArray(financeHist) && financeHist.length > 0) {
            adminFinanceMulti = true;
            chartData = financeHist.map((row: Record<string, unknown>) => ({
              label: typeof row.label === 'string' ? row.label : '',
              valorBruto: masterChartPointValue(row.valorBruto),
              valorLiquido: masterChartPointValue(row.valorLiquido),
              lucroSimpay: masterChartPointValue(row.lucroSimpay),
              taxaServico: masterChartPointValue(row.taxaServico ?? 0),
              taxaAdquirente: masterChartPointValue(row.taxaAdquirente),
              taxaSaque: masterChartPointValue(
                row.taxaSaqueDom ?? row.taxaSaque,
              ),
              lucroSaque: masterChartPointValue(row.lucroSaque),
              taxaSimInt: masterChartPointValue(
                row.taxaSimInt ??
                  Number(row.valorBruto ?? 0) - Number(row.valorLiquido ?? 0),
              ),
            }));
          } else if (isLucroMasterHistoricoPorHoraValido(historico)) {
            chartData = [...historico]
              .sort(
                (a, b) =>
                  parseInt(String(a.label ?? '').replace(/h$/, ''), 10) -
                  parseInt(String(b.label ?? '').replace(/h$/, ''), 10),
              )
              .map((row: Record<string, unknown>) => {
                const label = typeof row.label === 'string' ? row.label : '';
                const v = masterChartPointValue(
                  row.valor ??
                    row.lucroTotalMaster ??
                    row.total ??
                    row.value ??
                    0,
                );
                return { label, online: v, physical: 0 };
              });
          } else if (singleCalendarDay) {
            const detRaw = await api.get<unknown>(
              endpoints.relatorios.consolidado,
              {
                query: { ...queryRange, detalharLucro: 'true' },
              },
            );
            const det = unwrapConsolidadoPayload(detRaw);
            const lucroDet = det.lucroSimpayDetalhe;
            const mergedDet =
              lucroDet && typeof lucroDet === 'object'
                ? applyLucroSimpayDetalheConsolidadoMerges(
                    lucroDet as LucroSimpayDetalhe,
                    detRaw,
                  )
                : lucroDet;
            chartData = buildLucroMasterChartFromLucroSimpayDetalhe(mergedDet);
          } else if (Array.isArray(historico) && historico.length > 0) {
            chartData = historico.map((row: Record<string, unknown>) => {
              const label =
                (typeof row.label === 'string' && row.label) ||
                (typeof row.dia === 'string' && row.dia) ||
                (typeof row.data === 'string' && row.data) ||
                '';
              const v = masterChartPointValue(
                row.valor ??
                  row.lucroTotalMaster ??
                  row.total ??
                  row.value ??
                  0,
              );
              return { label, online: v, physical: 0 };
            });
          } else {
            // Sem série da API: reparte o total só para visualização (vários dias → por dia).
            const n = Math.max(1, daysInRange.length);
            const totalMaster = Number(res.lucroTotalMaster ?? 0);
            const perDay = totalMaster / n;
            chartData = daysInRange.map((day) => ({
              label: day.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
              }),
              online: masterChartPointValue(perDay),
              physical: 0,
            }));
          }

          data = {
            user: { name: currentUser?.name },
            summary: {
              availableBalance: Number(res.lucroTotalMaster ?? 0),
              balanceInProcessing: Number(res.lucroSimpay ?? 0),
              financialReserve: 0,
              withdrawalsInAnalysis: 0,
            },
            transactionsByPeriod: {
              totalSales: Number(
                adminFinanceMulti
                  ? (res.valorBruto ?? res.lucroTotalMaster ?? 0)
                  : (res.lucroTotalMaster ?? 0),
              ),
              paidTransactions: 0,
              approvalRate: 100,
              averageTicket: 0,
              onlineSalesRate: 100,
              physicalSalesRate: 0,
              chartData,
              _adminFinanceMulti: adminFinanceMulti,
            },
            paymentMethods: undefined,
            chargebacks: {
              totalRefunded: Number(
                res.estornos && typeof res.estornos === 'object'
                  ? (res.estornos as Record<string, unknown>).valor
                  : 0,
              ),
              chargebackNotifications: 0,
              refunds: {
                count: Number(
                  res.estornos && typeof res.estornos === 'object'
                    ? (res.estornos as Record<string, unknown>).quantidade
                    : 0,
                ),
                amount: Number(
                  res.estornos && typeof res.estornos === 'object'
                    ? (res.estornos as Record<string, unknown>).valor
                    : 0,
                ),
              },
              chargebackPrevention: { count: 0, amount: 0 },
              chargebacks: { count: 0, amount: 0 },
            },
            _adminMaster: true,
          };
        } else if (painelPlataformaTag) {
          const rangePv = periodToInclusiveRange(period);
          const res = await api.get<PlatformDashboard>(
            endpoints.admin.plataformas.dashboard(painelPlataformaTag),
            {
              query: {
                period,
                dataInicio: formatYmd(rangePv.start),
                dataFim: formatYmd(rangePv.end),
              },
            },
          );
          const estPv = pickRenovadaEstornos(res);
          const cbPv = pickRenovadaChargebacks(res);

          const chartSeries =
            Array.isArray(res.profit?.charts?.selectedRange) &&
            res.profit.charts.selectedRange.length > 0
              ? res.profit.charts.selectedRange
              : (res.profit?.charts?.last30Days ?? []);

          data = {
            user: { name: currentUser?.name },
            summary: {
              availableBalance: res.summary?.availableBalance ?? 0,
              balanceInProcessing: res.summary?.balanceInProcessing ?? 0,
              financialReserve: 0,
              withdrawalsInAnalysis: 0,
            },
            transactionsByPeriod: {
              totalSales: res.selected?.profit?.total ?? 0,
              paidTransactions: 0,
              approvalRate: 100,
              averageTicket: 0,
              onlineSalesRate: res.selected?.profit?.offersPct ?? 0,
              physicalSalesRate: res.selected?.profit?.maquinetasPct ?? 0,
              chartData: chartSeries.map(
                (p: {
                  label?: string;
                  offers?: number;
                  maquinetas?: number;
                }) => ({
                  label: String(p.label ?? ''),
                  online: Math.max(0, Number(p.offers ?? 0)),
                  physical: Math.max(0, Number(p.maquinetas ?? 0)),
                }),
              ),
            },
            paymentMethods: {
              offers: {
                percentage: res.selected?.profit?.offersPct ?? 0,
                amount: res.selected?.profit?.offers ?? 0,
              },
              maquinetas: {
                percentage: res.selected?.profit?.maquinetasPct ?? 0,
                amount: res.selected?.profit?.maquinetas ?? 0,
              },
            },
            chargebacks: {
              totalRefunded: estPv.valorLiquido,
              chargebackNotifications: 0,
              refunds: { count: estPv.quantidade, amount: estPv.valorLiquido },
              chargebackPrevention: { count: 0, amount: 0 },
              chargebacks: {
                count: cbPv.quantidade,
                amount: cbPv.valorLiquido,
              },
            },
          };
        } else if (isRevalida) {
          const res = await api.get<PlatformDashboard>(
            endpoints.relatorios.dashboardRevalida,
            { query: { period } },
          );
          data = mapRevalidaData(res, period, currentUser?.name);
        } else {
          const range = overrideRange ?? periodToInclusiveRange(period);
          data = await loadOwnedDashboard(
            api,
            formatYmd(range.start),
            formatYmd(range.end),
          );
        }

        return data;
      };
      return load()
        .then((data) => {
          if (request !== dashboardRequest.current) return;
          setDashboardData(data);
          hasLoadedOnce.current = true;
        })
        .catch((error: unknown) => {
          if (request === dashboardRequest.current)
            setDashboardError(
              'Não foi possível carregar o painel. Tente novamente.',
            );
          console.error('[Dashboard] Falha ao carregar dados:', error);
        })
        .finally(() => {
          if (request === dashboardRequest.current) {
            setIsLoading(false);
            setIsChartLoading(false);
          }
        });
    },
    [isAdmin, painelPlataformaTag, isRevalida, currentUser],
  );

  useEffect(() => {
    if (customRange.start && customRange.end) {
      fetchData(selectedPeriod, {
        start: customRange.start,
        end: customRange.end,
      });
    } else {
      fetchData(selectedPeriod);
    }
  }, [fetchData, selectedPeriod, customRange]);

  const fetchQuickStats = useCallback(async () => {
    if (!currentUser) return;
    const load = async () => {
      const token =
        typeof window !== 'undefined'
          ? (localStorage.getItem('access_token') ?? undefined)
          : undefined;
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => token,
      });

      const today = startOfDayLocal(new Date());
      const todayStr = formatYmd(today);
      const firstDayOfMonth = new Date(
        today.getFullYear(),
        today.getMonth(),
        1,
      );
      const firstDayOfMonthStr = formatYmd(firstDayOfMonth);

      if (!isAdmin) {
        const [todayResult, withdrawalsResult, monthResult] =
          await Promise.allSettled([
            api.get<ReportSummary>('/relatorios/financeiro', {
              query: { startDate: todayStr, endDate: todayStr },
            }),
            api.get<ReportPage<Saque>>(endpoints.saque.list, {
              query: { status: 'PENDING', page: 1, pageSize: 1 },
            }),
            api.get<ReportSummary>('/relatorios/financeiro', {
              query: { startDate: firstDayOfMonthStr, endDate: todayStr },
            }),
          ]);
        setQuickStats({
          transacoesHoje:
            todayResult.status === 'fulfilled'
              ? todayResult.value.summary.salesCount +
                (monthResult.status === 'fulfilled'
                  ? (monthResult.value.coproducao?.hourly ?? [])
                      .filter(({ bucket }) => bucket.startsWith(todayStr))
                      .reduce((total, { count }) => total + count, 0)
                  : 0)
              : null,
          saquesPendentesCount:
            withdrawalsResult.status === 'fulfilled'
              ? withdrawalsResult.value.total
              : null,
          saquesPendentesValor: null,
          receitaMensalLiquida:
            monthResult.status === 'fulfilled'
              ? (monthResult.value.summary.netCents +
                  (monthResult.value.coproducao?.creditedCents ?? 0)) /
                100
              : null,
        });
        return;
      }

      const [transacoesHojeRes, saquesPendentesRes, receitaMensalRes] =
        await Promise.allSettled([
          api.get<{
            items?: unknown[];
            data?: { items?: unknown[] };
            total?: number;
          }>(endpoints.relatorios.transacoesPorStatus, {
            query: { dataInicio: todayStr, dataFim: todayStr },
          }),
          api.get<{ total?: number; data?: Saque[] & { total?: number } }>(
            endpoints.admin.saques.list,
            {
              query: { status: 'PENDING', page: 1, pageSize: 200 },
            },
          ),
          api.get<unknown>(endpoints.relatorios.consolidado, {
            query: {
              periodType: CONSOLIDADO_PERIOD_TYPE,
              dataInicio: firstDayOfMonthStr,
              dataFim: todayStr,
              transactionType: CONSOLIDADO_TX_TYPE,
            },
          }),
        ]);

      let transacoesHoje: number | null = null;
      if (transacoesHojeRes.status === 'fulfilled') {
        const res = transacoesHojeRes.value;
        const items: unknown[] = res?.items ?? res?.data?.items ?? [];
        if (Array.isArray(items) && items.length > 0) {
          transacoesHoje = (items as Array<Record<string, unknown>>).reduce(
            (sum, item) => sum + Number(item.quantidade ?? 0),
            0,
          );
        } else if (typeof res?.total === 'number') {
          transacoesHoje = res.total;
        }
      }

      let saquesPendentesCount: number | null = null;
      let saquesPendentesValor: number | null = null;
      if (saquesPendentesRes.status === 'fulfilled') {
        const res = saquesPendentesRes.value;
        const total = res?.total ?? res?.data?.total;
        if (total != null) saquesPendentesCount = Number(total);
        const items: Saque[] = Array.isArray(res?.data)
          ? (res.data as Saque[])
          : [];
        if (Array.isArray(items)) {
          saquesPendentesValor = (
            items as Array<Record<string, unknown>>
          ).reduce((sum, s) => sum + Number(s.valorBruto ?? s.valor ?? 0), 0);
        }
        setPendingSaques(items.slice(0, 6));
      } else {
        setPendingSaques([]);
      }

      let receitaMensalLiquida: number | null = null;
      if (receitaMensalRes.status === 'fulfilled') {
        const res = unwrapConsolidadoPayload(receitaMensalRes.value);
        receitaMensalLiquida = Number(res.lucroTotalMaster ?? 0);
      }

      setQuickStats({
        transacoesHoje,
        saquesPendentesCount,
        saquesPendentesValor,
        receitaMensalLiquida,
      });
    };
    return load()
      .catch((err: unknown) => {
        console.error('[Dashboard] Falha ao carregar quick stats admin:', err);
      })
      .finally(() => {
        setIsLoadingQuickStats(false);
      });
  }, [isAdmin, currentUser]);

  useEffect(() => {
    fetchQuickStats();
  }, [fetchQuickStats]);

  const openAdminSaqueModal = useCallback(
    (saque: Saque, type: 'APPROVE' | 'REJECT') => {
      setAdminSaqueSelected(saque);
      setAdminSaqueActionType(type);
      setAdminSaqueRejectReason('');
      setAdminSaqueActionError(null);
      setAdminSaqueModalOpen(true);
    },
    [],
  );

  const closeAdminSaqueModal = useCallback(
    (force = false) => {
      if (isAdminSaqueSaving && !force) return;
      setAdminSaqueModalOpen(false);
      setAdminSaqueSelected(null);
      setAdminSaqueRejectReason('');
      setAdminSaqueActionError(null);
    },
    [isAdminSaqueSaving],
  );

  const handleAdminSaqueAction = useCallback(async () => {
    if (!adminSaqueSelected) return;
    if (adminSaqueActionType === 'REJECT' && !adminSaqueRejectReason.trim()) {
      setAdminSaqueActionError('Informe o motivo da recusa.');
      return;
    }

    setIsAdminSaqueSaving(true);
    setAdminSaqueActionError(null);
    try {
      const token =
        typeof window !== 'undefined'
          ? (localStorage.getItem('access_token') ?? undefined)
          : undefined;
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => token,
      });
      if (adminSaqueActionType === 'APPROVE') {
        await api.post(
          endpoints.admin.saques.approve(adminSaqueSelected.id),
          {},
        );
      } else {
        await api.post(endpoints.admin.saques.reject(adminSaqueSelected.id), {
          motivo: adminSaqueRejectReason.trim(),
        });
      }
      closeAdminSaqueModal(true);
      await fetchQuickStats();
    } catch (err) {
      setAdminSaqueActionError(
        err instanceof Error ? err.message : 'Erro ao processar saque.',
      );
    } finally {
      setIsAdminSaqueSaving(false);
    }
  }, [
    adminSaqueSelected,
    adminSaqueActionType,
    adminSaqueRejectReason,
    closeAdminSaqueModal,
    fetchQuickStats,
  ]);

  const s = dashboardData?.summary;
  const t = dashboardData?.transactionsByPeriod;
  const pm = dashboardData?.paymentMethods;
  const cb = dashboardData?.chargebacks;
  const userName = currentUser?.name ?? 'Usuário';

  const pieData = [
    {
      name: 'Ofertas',
      value: pm?.offers?.amount ?? 0,
      pct: pm?.offers?.percentage ?? 0,
      key: 'offers',
    },
    {
      name: 'Maquinetas',
      value: pm?.maquinetas?.amount ?? 0,
      pct: pm?.maquinetas?.percentage ?? 0,
      key: 'maquinetas',
    },
  ];
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);
  const chartData = useMemo(
    () =>
      (t?.chartData ?? []) as Array<
        | { label: string; online: number; physical: number }
        | AdminFinanceChartPoint
      >,
    [t?.chartData],
  );

  const adminMaster = Boolean(dashboardData?._adminMaster);
  const adminFinanceMulti = Boolean(t?._adminFinanceMulti);

  /** Eixo Y inclui valores negativos (prejuízo por hora/dia) no painel master. */
  const masterChartYDomain = useMemo((): [number, number] | undefined => {
    if (!adminMaster || chartData.length === 0) return undefined;
    if (adminFinanceMulti) {
      const keys = ADMIN_FINANCE_KEYS.filter((k) => adminFinSeries[k]);
      if (keys.length === 0) return [0, 100];
      const vals = keys.flatMap((k) =>
        chartData.map((d) => Number((d as AdminFinanceChartPoint)[k])),
      );
      const lo = Math.min(0, ...vals);
      const hi = Math.max(0, ...vals);
      if (lo === 0 && hi === 0) return [0, 100];
      const span = hi - lo;
      const pad = Math.max(
        span * 0.1,
        Math.abs(hi) * 0.05,
        Math.abs(lo) * 0.05,
        0.5,
      );
      return [lo - pad, hi + pad];
    }
    const vals = chartData.map((d) => Number((d as { online: number }).online));
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    if (lo === 0 && hi === 0) return [0, 100];
    const span = hi - lo;
    const pad = Math.max(
      span * 0.1,
      Math.abs(hi) * 0.05,
      Math.abs(lo) * 0.05,
      0.5,
    );
    return [lo - pad, hi + pad];
  }, [adminMaster, adminFinanceMulti, adminFinSeries, chartData]);

  /** Revalida: mesmo ajuste quando o lucro líquido diário vem negativo da API. */
  const revalidaChartYDomain = useMemo((): [number, number] | undefined => {
    if (
      !isRevalida ||
      adminMaster ||
      adminFinanceMulti ||
      chartData.length === 0
    )
      return undefined;
    const vals = chartData.map((d) => Number((d as { online: number }).online));
    if (!vals.some((v) => v < 0)) return undefined;
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const span = hi - lo;
    const pad = Math.max(
      span * 0.1,
      Math.abs(hi) * 0.05,
      Math.abs(lo) * 0.05,
      0.5,
    );
    return [lo - pad, hi + pad];
  }, [isRevalida, adminMaster, adminFinanceMulti, chartData]);

  const maxCBCount = Math.max(
    cb?.refunds?.count ?? 0,
    cb?.chargebackPrevention?.count ?? 0,
    cb?.chargebacks?.count ?? 0,
    1,
  );

  const displayedTotal = useMemo(() => {
    const total = t?.totalSales ?? 0;
    const adminMasterView = Boolean(dashboardData?._adminMaster);
    if (adminMasterView) {
      if (t?._adminFinanceMulti) {
        return total;
      }
      return showOnline ? total : 0;
    }
    if (isOwnedDashboard) return showOnline ? total : 0;
    if (showOnline && showPhysical) return total;
    if (showOnline) return total * ((t?.onlineSalesRate ?? 0) / 100);
    if (showPhysical) return total * ((t?.physicalSalesRate ?? 0) / 100);
    return 0;
  }, [
    showOnline,
    showPhysical,
    t,
    dashboardData?._adminMaster,
    t?._adminFinanceMulti,
    isOwnedDashboard,
  ]);

  const walletNetBalance = currentUser?.wallet?.netBalance ?? 0;

  const filteredPending = useMemo(() => {
    const totalPending = currentUser?.wallet?.lockedBalance ?? 0;

    if (showOnline && showPhysical) return totalPending;

    if (painelPlataformaTag && pm) {
      if (showOnline) return (totalPending * (t?.onlineSalesRate ?? 100)) / 100;
      if (showPhysical)
        return (totalPending * (t?.physicalSalesRate ?? 0)) / 100;
    }

    const onlineRate = (t?.onlineSalesRate ?? 100) / 100;
    const physicalRate = (t?.physicalSalesRate ?? 0) / 100;

    if (showOnline) return totalPending * onlineRate;
    if (showPhysical) return totalPending * physicalRate;

    return 0;
  }, [showOnline, showPhysical, t, pm, painelPlataformaTag, currentUser]);

  const displayAvailableBalance = adminMaster
    ? (s?.availableBalance ?? 0)
    : walletNetBalance;
  const displayProcessingBalance = adminMaster
    ? (s?.balanceInProcessing ?? 0)
    : filteredPending;

  const statTooltipFirstContent = adminMaster ? (
    <p
      style={{
        margin: 0,
        color: 'var(--painel-stat-tooltip-fg)',
        lineHeight: 1.45,
      }}
    >
      Lucro Simintpay sem deduzir taxa saque
    </p>
  ) : (
    <>
      <p
        style={{
          margin: '0 0 8px',
          fontWeight: 600,
          color: 'var(--painel-stat-tooltip-heading)',
        }}
      >
        Disponível
      </p>
      <p style={{ margin: 0, color: 'var(--painel-stat-tooltip-fg)' }}>
        Saldo{' '}
        <strong style={{ color: 'var(--painel-stat-tooltip-strong)' }}>
          líquido liberado
        </strong>{' '}
        na sua carteira: valor que já pode ser usado ou sacado, conforme as
        regras da conta.
      </p>
    </>
  );

  const statTooltipSecondContent = adminMaster ? (
    <p
      style={{
        margin: 0,
        color: 'var(--painel-stat-tooltip-fg)',
        lineHeight: 1.45,
      }}
    >
      Lucro Simintpay deduzindo taxas de saque
    </p>
  ) : (
    <>
      <p
        style={{
          margin: '0 0 8px',
          fontWeight: 600,
          color: 'var(--painel-stat-tooltip-heading)',
        }}
      >
        Em processamento
      </p>
      <p style={{ margin: 0, color: 'var(--painel-stat-tooltip-fg)' }}>
        Valores ainda{' '}
        <strong style={{ color: 'var(--painel-stat-tooltip-strong)' }}>
          bloqueados ou em liquidação
        </strong>{' '}
        na carteira (saldo em processamento). Quando as transações forem
        confirmadas, esse montante tende a integrar o disponível.
      </p>
      {painelPlataformaTag ? (
        <p
          style={{
            margin: '10px 0 0',
            color: 'var(--painel-stat-tooltip-note)',
            fontSize: 11.5,
          }}
        >
          Com os filtros On-line / Físicas ligados, o valor é repartido na mesma
          proporção do gráfico de vendas.
        </p>
      ) : null}
    </>
  );

  const txt = (s: string): React.CSSProperties => ({
    fontSize: { xs: 11, sm: 12, md: 13 }[s as 'xs' | 'sm' | 'md'] ?? 13,
    color: 'var(--painel-muted)',
  });

  if (isLoading || isLoadingQuickStats || !currentUser)
    return <DashboardPageSkeleton />;
  if (dashboardError)
    return (
      <div role="alert" className="rounded-xl border p-6">
        <p>{dashboardError}</p>
        <button
          type="button"
          className="mt-4 cursor-pointer rounded-lg border px-4 py-2"
          onClick={() =>
            void fetchData(
              selectedPeriod,
              customRange.start && customRange.end
                ? { start: customRange.start, end: customRange.end }
                : undefined,
            )
          }
        >
          Tentar novamente
        </button>
      </div>
    );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        .dk-page { font-family: 'Inter', sans-serif; color: var(--painel-fg); }
        .period-btn { padding: 5px 14px; border-radius: 20px; border: 1px solid var(--painel-period-border); background: transparent; color: var(--painel-period-fg); font-size: 12.5px; font-weight: 500; cursor: pointer; transition: all 0.2s; font-family: 'Inter', sans-serif; }
        .period-btn:hover { background: var(--painel-period-hover-bg); color: var(--painel-period-hover-fg); }
        .period-btn.active { background: #6d28d9; border-color: #6d28d9; color: #fff; }
        .eye-btn { background: var(--painel-eye-bg); border: 1px solid var(--painel-eye-border); border-radius: 8px; padding: 5px 7px; cursor: pointer; color: var(--painel-eye-fg); display: flex; align-items: center; transition: all 0.2s; }
        .eye-btn:hover { background: var(--painel-eye-hover-bg); color: var(--painel-eye-hover-fg); }
        .stat-card { background: var(--painel-stat-bg); border: 1px solid var(--painel-stat-border); border-radius: 14px; padding: 18px; transition: background 0.2s; }
        .stat-card:hover { background: var(--painel-stat-bg-hover); }
        .privacy-blur { filter: blur(10px); user-select: none; pointer-events: none; }
        .dash-tab-btn { padding: 7px 22px; border-radius: 24px; border: 1.5px solid var(--painel-period-border); background: transparent; color: var(--painel-period-fg); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: 'Inter', sans-serif; }
        .dash-tab-btn:hover { background: var(--painel-period-hover-bg); }
        .dash-tab-btn.active { background: #6d28d9; border-color: #6d28d9; color: #fff; }
      `}</style>

      {/* ── Tab switcher (apenas módulo master/admin) ── */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button
            className={`dash-tab-btn${activeTab === 'simintpay' ? ' active' : ''}`}
            onClick={() => setActiveTab('simintpay')}
          >
            Dom
          </button>
          {/* <button className={`dash-tab-btn${activeTab === "betai" ? " active" : ""}`} onClick={() => setActiveTab("betai")}>
            Betai
          </button> */}
          <button
            className={`dash-tab-btn${activeTab === 'futura-adquirente' ? ' active' : ''}`}
            onClick={() => setActiveTab('futura-adquirente')}
          >
            Futura adquirente
          </button>
        </div>
      )}

      {/* {activeTab === "betai" && <BetaiDashboard />} */}
      {activeTab === 'futura-adquirente' && (
        <div
          className="dk-page"
          style={{
            minHeight: 260,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--painel-card-border)',
            borderRadius: 14,
            background: 'var(--painel-stat-bg)',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--painel-heading)',
            }}
          >
            Em breve
          </p>
        </div>
      )}

      <div
        className="dk-page"
        style={{
          position: 'relative',
          minHeight: '100%',
          display: activeTab === 'simintpay' ? undefined : 'none',
        }}
      >
        <LoadingOverlay show={isLoading} />

        {/* Ambient glows */}
        <div
          style={{
            pointerEvents: 'none',
            position: 'fixed',
            top: 80,
            left: 220,
            width: 400,
            height: 400,
            background: 'var(--painel-glow-1)',
            borderRadius: '50%',
            filter: 'blur(80px)',
            zIndex: 0,
          }}
        />
        <div
          style={{
            pointerEvents: 'none',
            position: 'fixed',
            bottom: 100,
            right: 60,
            width: 300,
            height: 300,
            background: 'var(--painel-glow-2)',
            borderRadius: '50%',
            filter: 'blur(60px)',
            zIndex: 0,
          }}
        />

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {/* ── Page header ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--painel-subtle)',
                  marginBottom: 2,
                }}
              >
                Bem vindo, {userName}
              </p>
              <h1
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: 'var(--painel-heading)',
                  letterSpacing: '-0.5px',
                  lineHeight: 1.2,
                }}
              >
                Dashboard
              </h1>
            </div>
            <button
              onClick={() => setShowBalances((v) => !v)}
              className="eye-btn"
              aria-label={showBalances ? 'Ocultar saldos' : 'Mostrar saldos'}
            >
              {showBalances ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
          </div>

          {/* ── Main grid: left content (wide layout for all) ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 20,
              alignItems: 'start',
            }}
          >
            {/* ── LEFT COLUMN ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* ── Quick stats ── */}
              <div className="grid gap-3.5 sm:grid-cols-3">
                {/* Transações de hoje */}
                <div className="stat-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: 'rgba(124,58,237,0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CreditCard size={17} color="#a78bfa" />
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#a78bfa',
                        background: 'rgba(124,58,237,0.12)',
                        borderRadius: 20,
                        padding: '2px 8px',
                      }}
                    >
                      Hoje
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: 'var(--painel-heading)',
                      letterSpacing: '-0.5px',
                      lineHeight: 1.1,
                    }}
                  >
                    {isLoadingQuickStats
                      ? '—'
                      : quickStats.transacoesHoje !== null
                        ? quickStats.transacoesHoje.toLocaleString('pt-BR')
                        : '—'}
                  </p>
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--painel-subtle)',
                      marginTop: 4,
                    }}
                  >
                    Transações de hoje
                  </p>
                </div>

                {/* Saques pendentes */}
                <div className="stat-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: 'rgba(245,158,11,0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <AlertTriangle size={17} color="#f59e0b" />
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#f59e0b',
                        background: 'rgba(245,158,11,0.12)',
                        borderRadius: 20,
                        padding: '2px 8px',
                      }}
                    >
                      Pendente
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: 'var(--painel-heading)',
                      letterSpacing: '-0.5px',
                      lineHeight: 1.1,
                    }}
                  >
                    {isLoadingQuickStats
                      ? '—'
                      : quickStats.saquesPendentesCount !== null
                        ? quickStats.saquesPendentesCount.toLocaleString(
                            'pt-BR',
                          )
                        : '—'}
                  </p>
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--painel-subtle)',
                      marginTop: 4,
                    }}
                  >
                    Saques pendentes
                  </p>
                </div>

                {/* Receita líquida mês atual */}
                <div className="stat-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: 'rgba(16,185,129,0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <BarChart3 size={17} color="#10b981" />
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#10b981',
                        background: 'rgba(16,185,129,0.12)',
                        borderRadius: 20,
                        padding: '2px 8px',
                      }}
                    >
                      Mês atual
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: 'var(--painel-heading)',
                      letterSpacing: '-0.5px',
                      lineHeight: 1.1,
                    }}
                  >
                    <BlurValue
                      show={showBalances}
                      value={
                        isLoadingQuickStats ||
                        quickStats.receitaMensalLiquida === null
                          ? '—'
                          : formatBRL(quickStats.receitaMensalLiquida)
                      }
                    />
                  </p>
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--painel-subtle)',
                      marginTop: 4,
                    }}
                  >
                    Receita líquida (mês atual)
                  </p>
                </div>
              </div>

              {/* ── Chart card ── */}
              <div style={{ ...card, padding: 24, position: 'relative' }}>
                <LoadingOverlay show={isChartLoading} />

                {/* Chart header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    marginBottom: 20,
                  }}
                >
                  <div>
                    <p
                      style={{
                        fontSize: 12,
                        color: 'var(--painel-subtle)',
                        marginBottom: 2,
                      }}
                    >
                      {adminMaster && adminFinanceMulti
                        ? 'Resumo financeiro'
                        : adminMaster
                          ? 'Lucro total master no período'
                          : 'Vendas no período'}
                    </p>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                    >
                      <p
                        style={{
                          fontSize: 26,
                          fontWeight: 800,
                          color: 'var(--painel-heading)',
                          letterSpacing: '-0.5px',
                        }}
                      >
                        <BlurValue
                          show={showBalances}
                          value={formatBRL(displayedTotal)}
                        />
                      </p>
                      {!adminMaster ? (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color:
                              (t?.approvalRate ?? 0) >= 50
                                ? '#10b981'
                                : '#ef4444',
                            background:
                              (t?.approvalRate ?? 0) >= 50
                                ? 'rgba(16,185,129,0.12)'
                                : 'rgba(239,68,68,0.12)',
                            borderRadius: 20,
                            padding: '3px 8px',
                          }}
                        >
                          {fmtPct(t?.approvalRate)} aprovação
                        </span>
                      ) : null}
                    </div>
                    {!adminMaster && (t?.paidTransactions ?? 0) > 0 ? (
                      <p
                        style={{
                          fontSize: 12,
                          color: 'var(--painel-faint)',
                          marginTop: 2,
                        }}
                      >
                        {t?.paidTransactions} transações pagas
                      </p>
                    ) : null}
                    {adminMaster && adminFinanceMulti ? (
                      <p
                        style={{
                          fontSize: 12,
                          color: 'var(--painel-faint)',
                          marginTop: 4,
                        }}
                      >
                        Análise da receita, taxas e lucros por período
                      </p>
                    ) : null}
                  </div>

                  {/* Period selector */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexWrap: 'wrap',
                        justifyContent: 'flex-end',
                      }}
                    >
                      {PERIODS.map((p) => (
                        <button
                          key={p.key}
                          onClick={() => {
                            setSelectedPeriod(p.key);
                            setCustomRange({ start: null, end: null });
                          }}
                          className={`period-btn${selectedPeriod === p.key && !customRange.start ? ' active' : ''}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ width: 280 }}>
                      <DateRangePickerField
                        label=""
                        value={customRange}
                        onChange={(next) => setCustomRange(next)}
                        theme={fieldTheme}
                      />
                    </div>
                  </div>
                </div>

                {/* Series toggles */}
                {adminMaster && adminFinanceMulti ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginBottom: 16,
                    }}
                  >
                    {ADMIN_FINANCE_KEYS.map((key) => {
                      const on = adminFinSeries[key];
                      const col = adminFinanceChartConfig[key].color;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setAdminFinSeries((prev) => ({
                              ...prev,
                              [key]: !prev[key],
                            }))
                          }
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 10px',
                            borderRadius: 999,
                            border: on
                              ? '1px solid var(--painel-series-pill-on-border)'
                              : '1px solid var(--painel-series-pill-off-border)',
                            background: on
                              ? 'var(--painel-series-pill-on-bg)'
                              : 'transparent',
                            color: on
                              ? 'var(--painel-series-pill-on-fg)'
                              : 'var(--painel-series-pill-off-fg)',
                            fontSize: 11.5,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: col,
                              opacity: on ? 1 : 0.35,
                            }}
                          />
                          {adminFinanceChartConfig[key].label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <Toggle
                        checked={showOnline}
                        onChange={setShowOnline}
                        color="purple"
                      />
                      <span
                        style={{
                          fontSize: 12.5,
                          color: 'var(--painel-muted-2)',
                        }}
                      >
                        {adminMaster
                          ? 'Lucro master'
                          : isRevalida
                            ? 'Lucro Líquido'
                            : isOwnedDashboard
                              ? 'Vendas'
                              : 'On-line'}
                      </span>
                      {!adminMaster && !isOwnedDashboard ? (
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: '#a78bfa',
                          }}
                        >
                          {fmtPct(t?.onlineSalesRate)}
                        </span>
                      ) : null}
                    </div>
                    {!adminMaster && !isRevalida && !isOwnedDashboard ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <Toggle
                          checked={showPhysical}
                          onChange={setShowPhysical}
                          color="blue"
                        />
                        <span
                          style={{
                            fontSize: 12.5,
                            color: 'var(--painel-muted-2)',
                          }}
                        >
                          Físicas
                        </span>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: '#60a5fa',
                          }}
                        >
                          {fmtPct(t?.physicalSalesRate)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Gráfico: admin master com série financeira (6 linhas) ou área legado */}
                {chartData.length >= 1 ? (
                  adminFinanceMulti ? (
                    <ChartContainer
                      config={adminFinanceChartConfig}
                      style={{ height: 280, width: '100%' }}
                    >
                      <LineChart
                        data={chartData as AdminFinanceChartPoint[]}
                        margin={{ left: 4, right: 8, top: 4, bottom: 0 }}
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--painel-chart-grid)"
                        />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          tick={{
                            fontSize: 11,
                            fill: 'var(--painel-chart-tick)',
                          }}
                          minTickGap={5}
                        />
                        <YAxis
                          domain={
                            masterChartYDomain ?? [
                              0,
                              (dataMax: number) =>
                                dataMax === 0 ? 100 : dataMax * 1.1,
                            ]
                          }
                          tickLine={false}
                          axisLine={false}
                          tickMargin={4}
                          tick={{
                            fontSize: 10,
                            fill: 'var(--painel-chart-tick)',
                          }}
                          tickFormatter={(v) =>
                            v.toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                              notation: 'compact',
                            })
                          }
                        />
                        <ReferenceLine
                          y={0}
                          stroke="var(--painel-chart-ref)"
                          strokeDasharray="5 5"
                        />
                        <ChartTooltip
                          cursor={false}
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            return (
                              <div
                                style={{
                                  background: 'var(--painel-chart-tooltip-bg)',
                                  border:
                                    '1px solid var(--painel-chart-tooltip-border)',
                                  borderRadius: 12,
                                  padding: '10px 14px',
                                  fontSize: 12,
                                  minWidth: 220,
                                  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                                }}
                              >
                                <p
                                  style={{
                                    fontWeight: 600,
                                    color: 'var(--painel-chart-tooltip-title)',
                                    marginBottom: 8,
                                  }}
                                >
                                  {label}
                                </p>
                                <div
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 6,
                                  }}
                                >
                                  {payload.map((item) => {
                                    const key =
                                      item.dataKey as keyof typeof adminFinanceChartConfig;
                                    const cfg = adminFinanceChartConfig[key];
                                    if (!cfg) return null;
                                    const isLiquid = key === 'lucroSimpay';
                                    return (
                                      <div
                                        key={String(item.dataKey)}
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          gap: 16,
                                        }}
                                      >
                                        <span
                                          style={{
                                            color: isLiquid
                                              ? '#22c55e'
                                              : 'var(--painel-chart-tooltip-title)',
                                            fontWeight: isLiquid ? 700 : 400,
                                          }}
                                        >
                                          {cfg.label}
                                        </span>
                                        <span
                                          style={{
                                            fontWeight: isLiquid ? 700 : 600,
                                            color: isLiquid
                                              ? '#22c55e'
                                              : 'var(--painel-chart-tooltip-value)',
                                          }}
                                        >
                                          {formatBRL(Number(item.value))}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }}
                        />
                        {ADMIN_FINANCE_KEYS.map((key) =>
                          adminFinSeries[key] ? (
                            <Line
                              key={key}
                              dataKey={key}
                              type="monotone"
                              stroke={adminFinanceChartConfig[key].color}
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          ) : null,
                        )}
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <ChartContainer
                      config={salesChartConfig}
                      style={{ height: 220, width: '100%' }}
                    >
                      <AreaChart
                        data={chartData}
                        margin={{ left: 0, right: 0, top: 4, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="gOnline"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#7c3aed"
                              stopOpacity={0.35}
                            />
                            <stop
                              offset="95%"
                              stopColor="#7c3aed"
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                          <linearGradient
                            id="gPhysical"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#3b82f6"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="#3b82f6"
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--painel-chart-grid)"
                        />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          tick={{
                            fontSize: 11,
                            fill: 'var(--painel-chart-tick)',
                          }}
                          minTickGap={5}
                        />
                        <YAxis
                          domain={
                            masterChartYDomain ??
                            revalidaChartYDomain ?? [
                              0,
                              (dataMax: number) =>
                                dataMax === 0 ? 100 : dataMax * 1.1,
                            ]
                          }
                          tickLine={false}
                          axisLine={false}
                          tickMargin={4}
                          tick={{
                            fontSize: 10,
                            fill: 'var(--painel-chart-tick)',
                          }}
                          tickFormatter={(v) =>
                            v.toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                              notation: 'compact',
                            })
                          }
                        />
                        {adminMaster || revalidaChartYDomain ? (
                          <ReferenceLine
                            y={0}
                            stroke="var(--painel-chart-ref)"
                            strokeDasharray="5 5"
                          />
                        ) : null}
                        <ChartTooltip
                          cursor={false}
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;

                            const tooltipBox: CSSProperties = {
                              background: 'var(--painel-chart-tooltip-bg)',
                              border:
                                '1px solid var(--painel-chart-tooltip-border)',
                              borderRadius: 12,
                              padding: '10px 14px',
                              fontSize: 12,
                              minWidth: 200,
                              boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                            };

                            // Renovada / Bosque: uma linha para ofertas e outra para maquinetas (Recharts envia os dois no payload quando as áreas estão visíveis)
                            if (painelPlataformaTag && !isRevalida) {
                              const onlineEntry = payload.find(
                                (e) => e.dataKey === 'online',
                              );
                              const physicalEntry = payload.find(
                                (e) => e.dataKey === 'physical',
                              );
                              const vOnline =
                                onlineEntry != null
                                  ? Number(onlineEntry.value)
                                  : null;
                              const vPhysical =
                                physicalEntry != null
                                  ? Number(physicalEntry.value)
                                  : null;
                              if (vOnline === null && vPhysical === null)
                                return null;

                              return (
                                <div style={tooltipBox}>
                                  <p
                                    style={{
                                      fontWeight: 600,
                                      color:
                                        'var(--painel-chart-tooltip-title)',
                                      margin: '0 0 10px 0',
                                    }}
                                  >
                                    {label}
                                  </p>
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 8,
                                    }}
                                  >
                                    {vOnline !== null ? (
                                      <div
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: 24,
                                        }}
                                      >
                                        <span
                                          style={{
                                            color:
                                              'var(--painel-chart-tooltip-label)',
                                          }}
                                        >
                                          {vOnline < 0
                                            ? 'Prejuízo em Ofertas'
                                            : 'Lucro em Ofertas'}
                                        </span>
                                        <span
                                          style={{
                                            fontWeight: 700,
                                            color:
                                              vOnline < 0
                                                ? '#f87171'
                                                : 'var(--painel-chart-tooltip-value)',
                                          }}
                                        >
                                          {formatBRL(vOnline)}
                                        </span>
                                      </div>
                                    ) : null}
                                    {vPhysical !== null ? (
                                      <div
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: 24,
                                        }}
                                      >
                                        <span
                                          style={{
                                            color:
                                              'var(--painel-chart-tooltip-label)',
                                          }}
                                        >
                                          {vPhysical < 0
                                            ? 'Prejuízo em Maquinetas'
                                            : 'Lucro em Maquinetas'}
                                        </span>
                                        <span
                                          style={{
                                            fontWeight: 700,
                                            color:
                                              vPhysical < 0
                                                ? '#f87171'
                                                : 'var(--painel-chart-tooltip-value)',
                                          }}
                                        >
                                          {formatBRL(vPhysical)}
                                        </span>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            }

                            const onlineEntry = payload.find(
                              (e) => e.dataKey === 'online',
                            );
                            if (onlineEntry) {
                              const v = Number(onlineEntry.value);
                              const isLoss = v < 0;
                              let onlineLabel: string;
                              if (isRevalida) {
                                onlineLabel = isLoss ? 'Prejuízo' : 'Lucro';
                              } else {
                                onlineLabel = isOwnedDashboard
                                  ? 'Vendas'
                                  : salesChartConfig.online.label;
                              }
                              return (
                                <div style={tooltipBox}>
                                  <p
                                    style={{
                                      fontWeight: 600,
                                      color:
                                        'var(--painel-chart-tooltip-title)',
                                      marginBottom: 8,
                                    }}
                                  >
                                    {label}
                                  </p>
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      gap: 24,
                                    }}
                                  >
                                    <span
                                      style={{
                                        color:
                                          'var(--painel-chart-tooltip-label)',
                                      }}
                                    >
                                      {onlineLabel}
                                    </span>
                                    <span
                                      style={{
                                        fontWeight: 700,
                                        color: isLoss
                                          ? '#f87171'
                                          : 'var(--painel-chart-tooltip-value)',
                                      }}
                                    >
                                      {formatBRL(Number(onlineEntry.value))}
                                    </span>
                                  </div>
                                </div>
                              );
                            }
                            const physicalEntry = payload.find(
                              (e) => e.dataKey === 'physical',
                            );
                            if (!physicalEntry) return null;
                            const physicalLabel =
                              salesChartConfig.physical.label;
                            return (
                              <div style={tooltipBox}>
                                <p
                                  style={{
                                    fontWeight: 600,
                                    color: 'var(--painel-chart-tooltip-title)',
                                    marginBottom: 8,
                                  }}
                                >
                                  {label}
                                </p>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 24,
                                  }}
                                >
                                  <span
                                    style={{
                                      color:
                                        'var(--painel-chart-tooltip-label)',
                                    }}
                                  >
                                    {physicalLabel}
                                  </span>
                                  <span
                                    style={{
                                      fontWeight: 700,
                                      color:
                                        'var(--painel-chart-tooltip-value)',
                                    }}
                                  >
                                    {formatBRL(Number(physicalEntry.value))}
                                  </span>
                                </div>
                              </div>
                            );
                          }}
                        />
                        {showOnline && (
                          <Area
                            dataKey="online"
                            type="monotone"
                            fill="url(#gOnline)"
                            stroke="#7c3aed"
                            strokeWidth={2}
                            baseLine={0}
                          />
                        )}
                        {showPhysical &&
                        !isRevalida &&
                        !adminMaster &&
                        !isOwnedDashboard ? (
                          <Area
                            dataKey="physical"
                            type="monotone"
                            fill="url(#gPhysical)"
                            stroke="#3b82f6"
                            strokeWidth={2}
                          />
                        ) : null}
                      </AreaChart>
                    </ChartContainer>
                  )
                ) : (
                  <div
                    style={{
                      height: 220,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--painel-empty)',
                      fontSize: 13,
                    }}
                  >
                    Nenhum dado de gráfico para o período selecionado
                  </div>
                )}
              </div>

              {/* ── Bottom metrics row ── */}
              <div className="grid gap-3.5 sm:grid-cols-2">
                {/* Chargebacks / Estornos */}
                <div style={cardPad}>
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--painel-fg-strong)',
                      marginBottom: 16,
                    }}
                  >
                    Estornos
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 16,
                    }}
                  >
                    <div>
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--painel-subtle)',
                          marginBottom: 2,
                        }}
                      >
                        Total estornado
                      </p>
                      <p
                        style={{
                          fontSize: 17,
                          fontWeight: 700,
                          color: '#10b981',
                        }}
                      >
                        <BlurValue
                          show={showBalances}
                          value={formatBRL(cb?.totalRefunded)}
                        />
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--painel-subtle)',
                          marginBottom: 2,
                        }}
                      >
                        Qtd. estornos
                      </p>
                      <p
                        style={{
                          fontSize: 17,
                          fontWeight: 700,
                          color: '#f59e0b',
                        }}
                      >
                        {cb?.refunds?.count ?? 0}
                      </p>
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    <CBRow
                      label="Estornos"
                      count={cb?.refunds?.count ?? 0}
                      amount={cb?.refunds?.amount ?? 0}
                      maxCount={maxCBCount}
                    />
                  </div>
                </div>

                {/* Chargeback (plataforma client view) */}
                {!adminMaster && (
                  <div style={cardPad}>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--painel-fg-strong)',
                        marginBottom: 16,
                      }}
                    >
                      Chargeback
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 16,
                      }}
                    >
                      <div>
                        <p
                          style={{
                            fontSize: 11,
                            color: 'var(--painel-subtle)',
                            marginBottom: 2,
                          }}
                        >
                          Total em chargeback
                        </p>
                        <p
                          style={{
                            fontSize: 17,
                            fontWeight: 700,
                            color: '#ef4444',
                          }}
                        >
                          <BlurValue
                            show={showBalances}
                            value={formatBRL(cb?.chargebacks?.amount ?? 0)}
                          />
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p
                          style={{
                            fontSize: 11,
                            color: 'var(--painel-subtle)',
                            marginBottom: 2,
                          }}
                        >
                          Qtd. chargebacks
                        </p>
                        <p
                          style={{
                            fontSize: 17,
                            fontWeight: 700,
                            color: '#f59e0b',
                          }}
                        >
                          {cb?.chargebacks?.count ?? 0}
                        </p>
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                      }}
                    >
                      <CBRow
                        label="Chargebacks"
                        count={cb?.chargebacks?.count ?? 0}
                        amount={cb?.chargebacks?.amount ?? 0}
                        maxCount={maxCBCount}
                      />
                    </div>
                  </div>
                )}

                {/* Chargeback (admin master) */}
                {adminMaster && (
                  <div style={cardPad}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 16,
                      }}
                    >
                      <p
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--painel-fg-strong)',
                        }}
                      >
                        Chargeback
                      </p>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 16,
                      }}
                    >
                      <div>
                        <p
                          style={{
                            fontSize: 11,
                            color: 'var(--painel-subtle)',
                            marginBottom: 2,
                          }}
                        >
                          Valor total pendente
                        </p>
                        <p
                          style={{
                            fontSize: 17,
                            fontWeight: 700,
                            color: '#f59e0b',
                          }}
                        >
                          <BlurValue
                            show={showBalances}
                            value={
                              isLoadingQuickStats
                                ? '—'
                                : formatBRL(
                                    quickStats.saquesPendentesValor ?? 0,
                                  )
                            }
                          />
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p
                          style={{
                            fontSize: 11,
                            color: 'var(--painel-subtle)',
                            marginBottom: 2,
                          }}
                        >
                          Qtd. pendentes
                        </p>
                        <p
                          style={{
                            fontSize: 17,
                            fontWeight: 700,
                            color: '#f59e0b',
                          }}
                        >
                          {isLoadingQuickStats
                            ? '—'
                            : (quickStats.saquesPendentesCount ?? 0)}
                        </p>
                      </div>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: 'var(--painel-bar-track)',
                        borderRadius: 999,
                        overflow: 'hidden',
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width:
                            (quickStats.saquesPendentesCount ?? 0) > 0
                              ? '100%'
                              : '0%',
                          background:
                            'linear-gradient(90deg, #f59e0b, #ef4444)',
                          borderRadius: 999,
                          transition: 'width 0.5s',
                        }}
                      />
                    </div>
                    {isLoadingQuickStats ? (
                      <p
                        style={{ fontSize: 12, color: 'var(--painel-subtle)' }}
                      >
                        Carregando saques pendentes...
                      </p>
                    ) : pendingSaques.length === 0 ? (
                      <p
                        style={{ fontSize: 12, color: 'var(--painel-subtle)' }}
                      >
                        Nenhum saque pendente para análise.
                      </p>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        {pendingSaques.map((saque) => {
                          const cliente = saque.cliente ?? saque.usuario;
                          return (
                            <div
                              key={saque.id}
                              style={{
                                border: '1px solid var(--painel-card-border)',
                                borderRadius: 10,
                                padding: '10px 12px',
                                background: 'var(--painel-card-bg)',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 10,
                                  marginBottom: 8,
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <p
                                    style={{
                                      fontSize: 12.5,
                                      fontWeight: 700,
                                      color: 'var(--painel-fg-strong)',
                                      margin: 0,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {cliente?.nome ?? 'Cliente'}
                                  </p>
                                  <p
                                    style={{
                                      fontSize: 11,
                                      color: 'var(--painel-subtle)',
                                      margin: '2px 0 0',
                                    }}
                                  >
                                    {formatDateBR(saque.criadoEm)}
                                  </p>
                                </div>
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                    color: '#f59e0b',
                                  }}
                                >
                                  {formatBRL(saque.valorBruto ?? saque.valor)}
                                </p>
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openAdminSaqueModal(saque, 'APPROVE')
                                  }
                                  style={{
                                    padding: '5px 10px',
                                    borderRadius: 8,
                                    border: 'none',
                                    background: '#10b981',
                                    color: '#fff',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Aprovar
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openAdminSaqueModal(saque, 'REJECT')
                                  }
                                  style={{
                                    padding: '5px 10px',
                                    borderRadius: 8,
                                    border: '1px solid #ef4444',
                                    background: 'transparent',
                                    color: '#ef4444',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Recusar
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        <a
                          href="/admin/saques"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#f59e0b',
                            textDecoration: 'none',
                            opacity: 0.9,
                          }}
                        >
                          Ver todos os saques →
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* 2ª coluna: Total em Vendas (Renovada / Bosque) */}
                {painelPlataformaTag && !adminMaster && (
                  <div style={{ ...cardPad, height: '100%' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: 'rgba(124,58,237,0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <TrendingUp size={14} color="#a78bfa" />
                      </div>
                      <p
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--painel-label-soft)',
                        }}
                      >
                        Total em Vendas
                      </p>
                    </div>
                    <p
                      style={{
                        fontSize: 24,
                        fontWeight: 800,
                        color: 'var(--painel-heading)',
                        letterSpacing: '-0.6px',
                        lineHeight: 1.1,
                      }}
                    >
                      <BlurValue
                        show={showBalances}
                        value={formatBRL(t?.totalSales)}
                      />
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 4,
                        marginBottom: 18,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#10b981',
                          background: 'rgba(16,185,129,0.12)',
                          borderRadius: 20,
                          padding: '2px 8px',
                        }}
                      >
                        {fmtPct(t?.approvalRate)}
                      </span>
                      <span
                        style={{ fontSize: 11, color: 'var(--painel-faint)' }}
                      >
                        taxa de aprovação
                      </span>
                    </div>
                    <div>
                      {pieData.map(({ name, value, pct, key }) => (
                        <PMRow
                          key={key}
                          label={name}
                          amount={value}
                          pct={pct}
                          color={PIE_COLORS[key as keyof typeof PIE_COLORS]}
                          up={pct >= 0}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── REMOVIDO RIGHT PANEL ── */}
          </div>
        </div>
      </div>
      <Modal
        open={adminSaqueModalOpen}
        title={
          adminSaqueActionType === 'APPROVE' ? 'Aprovar saque' : 'Recusar saque'
        }
        onClose={() => closeAdminSaqueModal()}
        footer={
          <>
            <button
              type="button"
              onClick={() => closeAdminSaqueModal()}
              disabled={isAdminSaqueSaving}
              className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 disabled:opacity-50 dark:text-white/60 dark:hover:text-white/90"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleAdminSaqueAction}
              disabled={
                isAdminSaqueSaving ||
                (adminSaqueActionType === 'REJECT' &&
                  !adminSaqueRejectReason.trim())
              }
              className={`rounded-xl px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                adminSaqueActionType === 'APPROVE'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-red-600 hover:bg-red-500'
              }`}
            >
              {isAdminSaqueSaving
                ? 'Processando...'
                : adminSaqueActionType === 'APPROVE'
                  ? 'Confirmar aprovação'
                  : 'Confirmar recusa'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-white/50">
              Valor solicitado
            </div>
            <div className="text-2xl font-bold text-zinc-900 dark:text-white">
              {formatBRL(
                adminSaqueSelected?.valorBruto ?? adminSaqueSelected?.valor,
              )}
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-white/40">
              Valor líquido:{' '}
              {formatBRL(
                adminSaqueSelected?.valorLiquido ?? adminSaqueSelected?.valor,
              )}
            </div>
            <div className="mt-3 flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-white/5">
              <span className="text-sm font-medium text-zinc-800 dark:text-white/80">
                {adminSaqueSelected?.cliente?.nome ??
                  adminSaqueSelected?.usuario?.nome ??
                  'Cliente'}
              </span>
              <span className="text-xs text-zinc-500 dark:text-white/40">
                {adminSaqueSelected?.cliente?.email ??
                  adminSaqueSelected?.usuario?.email ??
                  '—'}
              </span>
              <span className="text-xs text-zinc-500 dark:text-white/40">
                Chave Pix: {adminSaqueSelected?.chavePix ?? '—'}
              </span>
            </div>
          </div>

          {adminSaqueActionType === 'REJECT' ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-white/50">
                Motivo da recusa <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={4}
                placeholder="Descreva o motivo da recusa..."
                value={adminSaqueRejectReason}
                onChange={(e) => setAdminSaqueRejectReason(e.target.value)}
                disabled={isAdminSaqueSaving}
                className={[
                  'w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors',
                  'placeholder:text-zinc-400 dark:placeholder:text-white/25',
                  fieldTheme === 'dark'
                    ? 'border-white/10 bg-white/5 text-white focus:border-violet-400/50 focus:ring-2 focus:ring-violet-300/10'
                    : 'border-zinc-200 bg-white text-zinc-900 focus:border-violet-400 focus:ring-2 focus:ring-violet-200',
                  'disabled:opacity-50',
                ].join(' ')}
              />
            </div>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-white/55">
              Ao aprovar, o saque será processado como concluído para o cliente.
            </p>
          )}

          {adminSaqueActionError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {adminSaqueActionError}
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
