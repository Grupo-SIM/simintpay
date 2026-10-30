'use client';

import { useMemo } from 'react';
import { Clock, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { cn, formatBRL } from '@/lib/utils';
import type { LucroSimpayDetalhe } from './LucroSimpayDetalhePanel';
import {
  buildLucroDiarioPorPlataformaRows,
  corGraficoPlataforma,
  tagLabel,
  type LucroPlataformaDailyRow,
} from '../utils/lucroPlataformaChart';

type Props = {
  title: string;
  subtitle: string;
  detalhe?: LucroSimpayDetalhe | null;
  series?: { rows: LucroPlataformaDailyRow[]; tags: string[]; total: number };
  ymdStart: string;
  ymdEnd: string;
  loading?: boolean;
  /** Quando false (e não está carregando), não exibe o gráfico — sem transações no período. */
  hasTransactionsInPeriod?: boolean;
};

export function LucroSimpayPlataformaBarCard({
  title,
  subtitle,
  detalhe,
  series,
  ymdStart,
  ymdEnd,
  loading,
  hasTransactionsInPeriod = true,
}: Props) {
  const { rows, tags, yDomain } = useMemo(() => {
    if (!detalhe && !series) {
      return {
        rows: [] as LucroPlataformaDailyRow[],
        tags: [] as string[],
        yDomain: [0, 1] as [number, number],
      };
    }
    const built =
      series ?? buildLucroDiarioPorPlataformaRows(detalhe!, ymdStart, ymdEnd);
    const activeTags = built.tags.filter((tag) =>
      built.rows.some((row) => Number(row[tag] ?? 0) !== 0),
    );
    let minV = 0;
    let maxV = 0;
    for (const row of built.rows) {
      let positive = 0;
      let negative = 0;
      for (const tag of activeTags) {
        const value = Number(row[tag] ?? 0);
        positive += Math.max(0, value);
        negative += Math.min(0, value);
      }
      minV = Math.min(minV, negative);
      maxV = Math.max(maxV, positive);
    }
    const lo = Math.min(0, minV);
    const hi = Math.max(0, maxV);
    const span = hi - lo || 1;
    const pad = span * 0.05;
    const yDomain: [number, number] =
      minV >= 0 ? [0, hi + pad] : [lo - pad, hi + pad];
    return {
      rows: built.rows,
      tags: activeTags,
      yDomain,
    };
  }, [detalhe, series, ymdStart, ymdEnd]);

  const chartConfig = useMemo(() => {
    const cfg: ChartConfig = {};
    for (const tag of tags) {
      cfg[tag] = {
        label: tagLabel(tag),
        color: corGraficoPlataforma(tag),
      };
    }
    return cfg;
  }, [tags]);

  const totalLucro = series?.total ?? detalhe?.lucroSimpayTotal ?? 0;
  const showChart =
    !loading &&
    hasTransactionsInPeriod &&
    (detalhe || series) &&
    tags.length > 0 &&
    rows.length > 0;
  const manyDays = rows.length > 16;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-3xl border border-white/40 bg-white/70 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5',
        'md:col-span-2',
      )}
    >
      <div
        className={cn('border-b border-zinc-200/70 p-4 dark:border-white/10')}
      >
        <div
          className={cn(
            'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
          )}
        >
          <div className={cn('flex items-start gap-3')}>
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
              )}
            >
              <TrendingUp className={cn('h-5 w-5')} strokeWidth={2} />
            </div>
            <div className={cn('min-w-0')}>
              <h3
                className={cn(
                  'text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100',
                )}
              >
                {title}
              </h3>
              <p
                className={cn(
                  'mt-0.5 inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400',
                )}
              >
                <Clock className={cn('h-3.5 w-3.5 shrink-0 opacity-80')} />
                {subtitle}
              </p>
            </div>
          </div>
          {showChart ? (
            <div className={cn('shrink-0 sm:text-right')}>
              <p className={cn('text-xs text-zinc-500 dark:text-zinc-400')}>
                Total período
              </p>
              <p
                className={cn(
                  'text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-100',
                )}
              >
                {formatBRL(totalLucro)}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className={cn('p-4 pb-6')}>
        {loading ? (
          <div
            role="status"
            aria-label="Carregando gráfico de lucro por plataforma"
            className={cn(
              'flex h-[280px] w-full animate-pulse items-end gap-3 rounded-2xl border border-zinc-200/60 p-6 dark:border-white/10',
            )}
          >
            {[45, 70, 35, 85, 60, 40, 75, 55, 90, 50].map((height, index) => (
              <div
                key={index}
                aria-hidden="true"
                className="flex-1 rounded-t bg-zinc-200/70 dark:bg-white/10"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        ) : !hasTransactionsInPeriod ? (
          <p
            className={cn(
              'py-12 text-center text-sm text-zinc-500 dark:text-zinc-400',
            )}
          >
            Sem transações no período filtrado.
          </p>
        ) : !detalhe && !series ? (
          <p
            className={cn(
              'py-12 text-center text-sm text-zinc-500 dark:text-zinc-400',
            )}
          >
            Dados de lucro indisponíveis. Atualize o relatório.
          </p>
        ) : tags.length === 0 ? (
          <p
            className={cn(
              'py-12 text-center text-sm text-zinc-500 dark:text-zinc-400',
            )}
          >
            Nenhuma movimentação de lucro no período.
          </p>
        ) : rows.length === 0 ? (
          <p
            className={cn(
              'py-12 text-center text-sm text-zinc-500 dark:text-zinc-400',
            )}
          >
            Intervalo inválido.
          </p>
        ) : (
          <div
            className={cn(
              'rounded-2xl border border-zinc-200/60 bg-zinc-50/80 p-3 dark:border-white/10 dark:bg-zinc-950/40',
            )}
          >
            <ChartContainer
              config={chartConfig}
              className={cn(
                'h-[280px] w-full min-w-0 aspect-auto text-zinc-500 dark:text-zinc-400',
              )}
            >
              <BarChart
                accessibilityLayer
                data={rows}
                stackOffset="sign"
                barCategoryGap="20%"
                maxBarSize={48}
                margin={{
                  left: 4,
                  right: 4,
                  top: 8,
                  bottom: manyDays ? 20 : 8,
                }}
              >
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  strokeOpacity={0.45}
                />
                <ReferenceLine
                  y={0}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                />
                <YAxis
                  width={40}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  domain={yDomain}
                  tick={{ fontSize: 11, fill: 'currentColor' }}
                  tickFormatter={(v) =>
                    Number(v).toLocaleString('pt-BR', {
                      notation:
                        Math.abs(Number(v)) >= 1000 ? 'compact' : 'standard',
                      maximumFractionDigits: 0,
                    })
                  }
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  interval={manyDays ? 'preserveStartEnd' : 0}
                  minTickGap={manyDays ? 8 : 0}
                  angle={manyDays ? -35 : 0}
                  textAnchor={manyDays ? 'end' : 'middle'}
                  height={manyDays ? 48 : 32}
                  tick={{ fontSize: 11, fill: 'currentColor' }}
                />
                <ChartTooltip
                  cursor={false}
                  content={({ active, payload, label }) => (
                    <ChartTooltipContent
                      active={active}
                      payload={payload?.filter((p) => {
                        const key = String(p.dataKey ?? '');
                        return key !== '' && Number(p.value ?? 0) !== 0;
                      })}
                      label={label}
                      indicator="dashed"
                      labelFormatter={(_label, pl) => {
                        const row = pl?.[0]?.payload as
                          LucroPlataformaDailyRow | undefined;
                        if (row?.dateKey) {
                          return `${row.label} · ${row.dateKey}`;
                        }
                        return String(_label ?? '');
                      }}
                      formatter={(value, name) => (
                        <div className="flex w-full min-w-40 items-center justify-between gap-4">
                          <span className="text-muted-foreground">{name}</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {formatBRL(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  )}
                />
                {tags.map((tag) => (
                  <Bar
                    key={tag}
                    dataKey={tag}
                    name={tagLabel(tag)}
                    fill={`var(--color-${tag})`}
                    stackId="stack"
                    radius={0}
                    isAnimationActive={false}
                    maxBarSize={48}
                  />
                ))}
              </BarChart>
            </ChartContainer>
            <ul
              aria-label="Plataformas do gráfico"
              className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-3 border-t border-zinc-200/60 px-2 pt-4 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-300"
            >
              {tags.map((tag) => (
                <li key={tag} className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: corGraficoPlataforma(tag) }}
                  />
                  <span className="break-words">{tagLabel(tag)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
