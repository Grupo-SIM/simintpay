import { Banknote, Percent, Smartphone } from 'lucide-react';
import { MetricCard } from './MetricCard';
import { ReportMetricSection } from './ReportMetricSection';
import type { ReportSummary } from './report-types';
import { reportMoney } from './report-types';

export function MaquinetaSection({
  summary,
}: {
  summary: ReportSummary['summary'];
}) {
  const count = summary.maquinetaCount ?? 0;
  if (count <= 0) return null;
  return (
    <ReportMetricSection title="Maquinetas">
      <MetricCard
        label="Valor transacionado"
        value={reportMoney(summary.maquinetaGrossCents ?? 0)}
        detail={`${count} ${count === 1 ? 'venda' : 'vendas'}`}
        icon={Smartphone}
        tooltip="Valor bruto das vendas aprovadas na maquineta."
        valueClassName="text-emerald-600 dark:text-emerald-400"
        iconClassName="text-emerald-600 dark:text-emerald-400"
      />
      <MetricCard
        label="Taxa SimIntPay"
        value={reportMoney(summary.maquinetaFeesCents ?? 0)}
        icon={Percent}
        tooltip="Taxas cobradas nas vendas aprovadas na maquineta."
        valueClassName="text-rose-600 dark:text-rose-400"
        iconClassName="text-rose-600 dark:text-rose-400"
      />
      <MetricCard
        label="Total de repasse"
        value={reportMoney(summary.maquinetaNetCents ?? 0)}
        icon={Banknote}
        tooltip="Líquido das vendas na maquineta após as taxas."
        valueClassName="text-cyan-600 dark:text-cyan-400"
        iconClassName="text-cyan-600 dark:text-cyan-400"
      />
    </ReportMetricSection>
  );
}
