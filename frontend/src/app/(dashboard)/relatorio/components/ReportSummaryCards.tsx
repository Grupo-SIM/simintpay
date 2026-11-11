import {
  ArrowDownToLine,
  Banknote,
  CreditCard,
  Hash,
  Percent,
  TrendingUp,
  Users,
} from 'lucide-react';
import { ReportMovementSections } from './ReportMovementSections';
import { MetricCard } from './MetricCard';
import { ReportMetricSection } from './ReportMetricSection';
import type { ReportSummary } from './report-types';
import { reportMoney } from './report-types';

export function ReportSummaryCards({ data }: { data: ReportSummary }) {
  const s = data.summary;
  // Coproduction receipts count as sales, revenue and gross profit of the overview.
  const coSales = data.coproducao?.creditedCount ?? 0;
  const coCents = data.coproducao?.creditedCents ?? 0;
  return (
    <div className="flex flex-col gap-8">
      <ReportMetricSection title="Visão Geral">
        <MetricCard
          label="Total de vendas"
          value={String(s.salesCount + coSales)}
          icon={Hash}
          tooltip="Transações aprovadas no período, incluindo recebimentos de coprodução creditados."
          valueClassName="text-sky-600 dark:text-sky-400"
          iconClassName="text-sky-600 dark:text-sky-400"
        />
        <MetricCard
          label="Receita Total"
          value={reportMoney(s.grossCents + coCents)}
          icon={TrendingUp}
          tooltip="Valor bruto das vendas aprovadas, somado às participações de coprodução creditadas."
          valueClassName="text-emerald-600 dark:text-emerald-400"
          iconClassName="text-emerald-600 dark:text-emerald-400"
        />
        <MetricCard
          label="Lucro bruto"
          value={reportMoney(s.netCents + coCents)}
          icon={Banknote}
          tooltip="Líquido das vendas e participações de coprodução antes da taxa de saque."
          valueClassName="text-cyan-600 dark:text-cyan-400"
          iconClassName="text-cyan-600 dark:text-cyan-400"
        />
        <MetricCard
          label="Quantidade de clientes"
          value={
            s.customersCount == null
              ? 'Não informado'
              : s.customersCount.toLocaleString('pt-BR')
          }
          icon={Users}
          tooltip="Compradores únicos por CPF nas vendas aprovadas do período. Compras sem CPF não entram na contagem."
          valueClassName="text-blue-600 dark:text-blue-400"
          iconClassName="text-blue-600 dark:text-blue-400"
        />
      </ReportMetricSection>
      <ReportMetricSection title="Custos">
        <MetricCard
          label="Total de taxas SimIntPay"
          value={reportMoney(s.feesCents)}
          icon={Percent}
          tooltip="Total de taxas cobradas nas vendas do período."
          valueClassName="text-rose-600 dark:text-rose-400"
          iconClassName="text-rose-600 dark:text-rose-400"
        />
        <MetricCard
          label="Juros brutos"
          value={reportMoney(s.interestCents ?? 0)}
          icon={CreditCard}
          tooltip="Juros de parcelamento cobrados do comprador nas vendas do período. Vendas sem juros registrados contam como zero."
          valueClassName="text-amber-600 dark:text-amber-400"
          iconClassName="text-amber-600 dark:text-amber-400"
        />
        <MetricCard
          label="Taxa de saque"
          value={
            s.withdrawalFeesCents == null
              ? 'Não informado'
              : reportMoney(s.withdrawalFeesCents)
          }
          icon={ArrowDownToLine}
          tooltip="Total de taxas cobradas nos saques aprovados ou concluídos das plataformas selecionadas no período. O filtro de método aplica-se somente às vendas."
          valueClassName="text-orange-600 dark:text-orange-400"
          iconClassName="text-orange-600 dark:text-orange-400"
        />
      </ReportMetricSection>
      <ReportMovementSections
        summary={s}
        coproducao={data.coproducao}
        hasPlatforms={data.platformsCount > 0}
      />
      {!s.historicalAttributionComplete && (
        <p role="status" className="text-sm text-amber-600">
          Histórico com atribuição incompleta. Lançamentos sem identificação ou
          líquido persistido não foram estimados.
        </p>
      )}
    </div>
  );
}
