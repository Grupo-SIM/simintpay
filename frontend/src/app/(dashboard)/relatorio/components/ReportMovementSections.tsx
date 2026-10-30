import {
  AlertTriangle,
  Clock,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { MetricCard } from './MetricCard';
import { ReportMetricSection } from './ReportMetricSection';
import { reportMoney, type ReportSummary } from './report-types';

export function ReportMovementSections({
  summary: s,
}: {
  summary: ReportSummary['summary'];
}) {
  const money = (value: number | undefined) =>
    value == null ? 'Não informado' : reportMoney(value);
  const count = (value: number | undefined) =>
    value == null
      ? 'Quantidade não informada'
      : `${value.toLocaleString('pt-BR')} ${value === 1 ? 'venda' : 'vendas'}`;
  return (
    <ReportMetricSection title="Movimentações">
      <MetricCard
        label="Vendas aprovadas"
        value={money(s.grossCents)}
        detail={count(s.salesCount)}
        icon={TrendingUp}
        valueClassName="text-emerald-600 dark:text-emerald-400"
        iconClassName="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
        tooltip="Valor bruto e quantidade de vendas aprovadas no período."
      />
      <MetricCard
        label="Vendas pendentes"
        value={money(s.pendingSalesCents)}
        detail={count(s.pendingSalesCount)}
        icon={Clock}
        valueClassName="text-amber-600 dark:text-amber-400"
        iconClassName="bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
      />
      <MetricCard
        label="Vendas recusadas"
        value={money(s.failedSalesCents)}
        detail={count(s.failedSalesCount)}
        icon={XCircle}
        valueClassName="text-rose-600 dark:text-rose-400"
        iconClassName="bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400"
      />
      <MetricCard
        label="Estornos"
        value={money(s.refundedCents)}
        detail={count(s.refundedCount)}
        icon={TrendingDown}
        valueClassName="text-rose-600 dark:text-rose-400"
        iconClassName="bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400"
        tooltip="Valor líquido estornado e quantidade de vendas estornadas."
      />
      <MetricCard
        label="Chargebacks"
        value={money(s.chargebacksCents)}
        detail={count(s.chargebacksCount)}
        icon={AlertTriangle}
        valueClassName="text-orange-600 dark:text-orange-400"
        iconClassName="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
        tooltip="Valor líquido contestado e quantidade de vendas com chargeback."
      />
    </ReportMetricSection>
  );
}
