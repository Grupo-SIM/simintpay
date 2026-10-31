'use client';

import * as React from 'react';
import { Pie, PieChart, Cell } from 'recharts';
import type { LucideIcon } from 'lucide-react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { TransacaoDistribuicaoItem } from '../types';
import { transacaoDistribuicaoTemDados } from '../utils';

const SLICE_PALETTE = [
  'hsl(217 91% 60%)',
  'hsl(142 71% 45%)',
  'hsl(38 92% 50%)',
  'hsl(0 84% 60%)',
  'hsl(263 70% 58%)',
  'hsl(199 89% 48%)',
  'hsl(330 81% 60%)',
  'hsl(215 16% 47%)',
];

function safeChartKey(codigo: string, index: number) {
  const s = codigo.replace(/[^a-zA-Z0-9_-]/g, '_');
  return s || `slice_${index}`;
}

type Props = {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconClassName: string;
  items: TransacaoDistribuicaoItem[];
  /** Total de transações no período (campo `total` da API), se existir. */
  distributionTotal?: number;
  loading?: boolean;
  /**
   * Quando true, não renderiza o gráfico: consolidado do mesmo período já retornou com valor bruto ≤ 0
   * (evita dados defasados ou inconsistentes da API de distribuição).
   */
  suppressChartConsolidadoZero?: boolean;
};

export function ReportDistributionPieCard({
  title,
  subtitle,
  icon: Icon,
  iconClassName,
  items,
  distributionTotal,
  loading,
  suppressChartConsolidadoZero = false,
}: Props) {
  const hasTransactions = transacaoDistribuicaoTemDados({
    total: distributionTotal,
    items,
  });

  const itemsPositivos = React.useMemo(
    () => items.filter((i) => Number(i.quantidade) > 0),
    [items],
  );

  const { chartData, chartConfig } = React.useMemo(() => {
    const config: ChartConfig = {};
    const data = itemsPositivos.map((item, i) => {
      const key = safeChartKey(item.codigo, i);
      config[key] = {
        label: item.nome,
        color: SLICE_PALETTE[i % SLICE_PALETTE.length],
      };
      return {
        chartKey: key,
        nome: item.nome,
        quantidade: item.quantidade,
        percentual: item.percentual,
        fill: `var(--color-${key})`,
      };
    });
    return { chartData: data, chartConfig: config };
  }, [itemsPositivos]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/40 bg-white/70 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="border-b border-zinc-200/70 p-4 dark:border-white/10">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              iconClassName,
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {title}
            </h3>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <Clock className="h-3.5 w-3.5 shrink-0 opacity-80" />
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-[280px] flex-col items-center justify-center p-4 pb-6">
        {loading ? (
          <div className="flex h-[240px] w-full max-w-[260px] animate-pulse items-center justify-center rounded-full bg-zinc-200/50 dark:bg-white/10" />
        ) : suppressChartConsolidadoZero ||
          !hasTransactions ||
          chartData.length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Sem transações no período filtrado.
          </p>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="mx-auto aspect-square h-[min(280px,85vw)] w-full max-w-[280px]"
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    nameKey="chartKey"
                    hideLabel
                    formatter={(value, _name, tooltipItem) => {
                      const p = tooltipItem?.payload as
                        { nome?: string; percentual?: number } | undefined;
                      return (
                        <div className="flex w-full flex-col gap-0.5">
                          <span className="text-muted-foreground">
                            {p?.nome ?? '—'}
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {Number(value).toLocaleString('pt-BR')} (
                            {Number(p?.percentual ?? 0).toLocaleString(
                              'pt-BR',
                              {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 2,
                              },
                            )}
                            %)
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Pie
                data={chartData}
                dataKey="quantidade"
                nameKey="chartKey"
                innerRadius={52}
                strokeWidth={2}
                className="stroke-background"
                isAnimationActive={false}
              >
                {chartData.map((entry) => (
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
  );
}
