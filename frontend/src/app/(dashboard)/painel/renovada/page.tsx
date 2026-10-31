'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useSaquesSummary } from '@/features/saques/hooks/use-saques';
import { useCurrentUser } from '@/hooks/use-current-user';
import { isNegativeMoneyString } from '@/lib/utils';
import { LoadingOverlay } from '@/components/ui/Loading';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import {
  Smartphone,
  CreditCard,
  ArrowDownToLine,
  Wallet,
  ShieldAlert,
} from 'lucide-react';

type StatCardProps = {
  title: string;
  value: string;
  subtitle?: string;
  icon: import('lucide-react').LucideIcon;
  color?: string;
  bg?: string;
};

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = '#7c3aed',
  bg = 'rgba(124,58,237,0.1)',
}: StatCardProps) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16,
        padding: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={20} color={color} />
        </div>
      </div>
      <p
        style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.4)',
          marginBottom: 4,
        }}
      >
        {title}
      </p>
      <h3
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: isNegativeMoneyString(value) ? '#f87171' : '#f1f5f9',
          letterSpacing: '-0.5px',
        }}
      >
        {value}
      </h3>
      {subtitle && (
        <p
          style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

function formatBRL(value: number | undefined | null) {
  const v = Number(value ?? 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type RenovadaOverview = {
  profit?: {
    total?: number;
    maquinetas?: number;
    offers?: number;
    charts?: {
      last30Days?: { date: string; total: number }[];
      annualByMonth?: { month: string; total: number }[];
    };
    today?: { total?: number };
    sevenDays?: { total?: number };
    fifteenDays?: { total?: number };
    thirtyDays?: { total?: number };
  };
  withdrawals?: {
    today?: number;
    sevenDays?: number;
    thirtyDays?: number;
    annual?: number;
  };
  estornos?: { quantidade?: number; valorLiquido?: number };
};

export default function RenovadaDashboardPage() {
  const { user: currentUser } = useCurrentUser();
  const { data: saquesSummary } = useSaquesSummary();
  const [data, setData] = useState<RenovadaOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [chartPeriod, setChartPeriod] = useState<'30d' | 'annual'>('30d');

  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let active = true;
    const token = localStorage.getItem('access_token');
    const api = createApiClient({
      baseUrl: getDefaultApiBaseUrl(),
      getToken: () => token ?? undefined,
    });
    api
      .get<RenovadaOverview>(endpoints.relatorios.dashboardRenovada)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error) =>
        console.error('Erro ao carregar dashboard renovada:', error),
      )
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  if (isLoading && !data) return <LoadingOverlay show={true} />;

  const profit = data?.profit;
  const withdrawals = data?.withdrawals;
  const estornos = data?.estornos;
  const chartData =
    chartPeriod === '30d'
      ? profit?.charts?.last30Days
      : profit?.charts?.annualByMonth;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: "'Inter', sans-serif",
        color: '#e2e8f0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            Módulo Especial
          </p>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#f8fafc',
              letterSpacing: '-0.5px',
            }}
          >
            Dashboard Renovada
          </h1>
        </div>
        <button
          onClick={() => {
            setIsLoading(true);
            setRefreshKey((key) => key + 1);
          }}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding: '8px 16px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Atualizar
        </button>
      </div>

      {/* Stats Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 20,
        }}
      >
        <StatCard
          title="Saldo disponível"
          value={formatBRL(
            currentUser?.wallet?.netBalance ?? profit?.total ?? 0,
          )}
          icon={Wallet}
          color="#10b981"
          bg="rgba(16,185,129,0.1)"
        />
        <StatCard
          title="Maquinetas"
          value={formatBRL(profit?.maquinetas ?? 0)}
          icon={Smartphone}
          color="#3b82f6"
          bg="rgba(59,130,246,0.1)"
        />
        <StatCard
          title="Ofertas"
          value={formatBRL(profit?.offers ?? 0)}
          icon={CreditCard}
          color="#a78bfa"
          bg="rgba(167,139,250,0.1)"
        />
        <StatCard
          title="Saques Hoje"
          value={String(withdrawals?.today ?? 0)}
          subtitle={`${withdrawals?.thirtyDays ?? 0} nos últimos 30 dias`}
          icon={ArrowDownToLine}
          color="#f59e0b"
          bg="rgba(245,158,11,0.1)"
        />
        <StatCard
          title="Estornos"
          value={String(estornos?.quantidade ?? 0)}
          subtitle={`Valor líquido: ${formatBRL(estornos?.valorLiquido ?? 0)}`}
          icon={ShieldAlert}
          color="#ef4444"
          bg="rgba(239,68,68,0.1)"
        />
      </div>

      {/* Chart Section */}
      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20,
          padding: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 32,
          }}
        >
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>
              Desempenho de Lucro
            </h3>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              Lucro líquido consolidado no período
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 10,
              padding: 4,
            }}
          >
            <button
              onClick={() => setChartPeriod('30d')}
              style={{
                padding: '6px 16px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                background: chartPeriod === '30d' ? '#6d28d9' : 'transparent',
                color: chartPeriod === '30d' ? '#fff' : 'rgba(255,255,255,0.5)',
              }}
            >
              30 Dias
            </button>
            <button
              onClick={() => setChartPeriod('annual')}
              style={{
                padding: '6px 16px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                background:
                  chartPeriod === 'annual' ? '#6d28d9' : 'transparent',
                color:
                  chartPeriod === 'annual' ? '#fff' : 'rgba(255,255,255,0.5)',
              }}
            >
              Anual
            </button>
          </div>
        </div>

        <div style={{ height: 350, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.4)' }}
                tickMargin={12}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.4)' }}
                tickFormatter={(v) => `R$ ${v}`}
              />
              <Tooltip
                contentStyle={{
                  background: '#1e1b4b',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12,
                  color: '#fff',
                }}
                itemStyle={{ color: '#a78bfa' }}
                formatter={(v: number | string) => [
                  formatBRL(Number(v)),
                  'Lucro Líquido',
                ]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#7c3aed"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorProfit)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 20,
            padding: 24,
          }}
        >
          <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            Resumo de Lucro
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingBottom: 8,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                Hoje
              </span>
              <span style={{ fontWeight: 600 }}>
                {formatBRL(profit?.today?.total ?? 0)}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingBottom: 8,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                Últimos 7 dias
              </span>
              <span style={{ fontWeight: 600 }}>
                {formatBRL(profit?.sevenDays?.total ?? 0)}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingBottom: 8,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                Últimos 15 dias
              </span>
              <span style={{ fontWeight: 600 }}>
                {formatBRL(profit?.fifteenDays?.total ?? 0)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                Últimos 30 dias
              </span>
              <span style={{ fontWeight: 600 }}>
                {formatBRL(profit?.thirtyDays?.total ?? 0)}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 20,
            padding: 24,
          }}
        >
          <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            Resumo de Saques
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingBottom: 8,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                Hoje
              </span>
              <span style={{ fontWeight: 600 }}>{withdrawals?.today ?? 0}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingBottom: 8,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                Últimos 7 dias
              </span>
              <span style={{ fontWeight: 600 }}>
                {withdrawals?.sevenDays ?? 0}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingBottom: 8,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                Últimos 30 dias
              </span>
              <span style={{ fontWeight: 600 }}>
                {withdrawals?.thirtyDays ?? 0}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                Total Anual
              </span>
              <span style={{ fontWeight: 600 }}>
                {withdrawals?.annual ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
