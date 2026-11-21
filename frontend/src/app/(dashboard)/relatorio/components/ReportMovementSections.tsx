import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Clock,
  HandCoins,
  Handshake,
  Smartphone,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { MetricCard } from './MetricCard';
import { ReportMetricSection } from './ReportMetricSection';
import { reportMoney, type ReportSummary } from './report-types';

export function ReportMovementSections({
  summary: s,
  coproducao,
  afiliacao,
  afiliados,
  hasPlatforms = true,
  boletos,
  extra,
}: {
  summary: ReportSummary['summary'];
  coproducao?: ReportSummary['coproducao'];
  afiliacao?: ReportSummary['afiliacao'];
  afiliados?: ReportSummary['afiliados'];
  hasPlatforms?: boolean;
  /** Card de boletos, exibido antes de estornos. */
  boletos?: ReactNode;
  extra?: ReactNode;
}) {
  const money = (value: number | undefined) =>
    value == null ? 'Não informado' : reportMoney(value);
  const count = (value: number | undefined) =>
    value == null
      ? 'Quantidade não informada'
      : `${value.toLocaleString('pt-BR')} ${value === 1 ? 'venda' : 'vendas'}`;
  return (
    <ReportMetricSection title="Movimentações">
      {hasPlatforms && (
        <>
          <MetricCard
            label="Vendas aprovadas"
            value={money(s.grossCents)}
            detail={count(s.salesCount)}
            icon={TrendingUp}
            valueClassName="text-emerald-600 dark:text-emerald-400"
            iconClassName="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
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
          {boletos}
          {(s.maquinetaCount ?? 0) > 0 && (
            <MetricCard
              label="Maquinetas"
              value={money(s.maquinetaGrossCents)}
              detail={count(s.maquinetaCount)}
              icon={Smartphone}
              valueClassName="text-emerald-600 dark:text-emerald-400"
              iconClassName="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
            />
          )}
          <MetricCard
            label="Estornos"
            value={money(s.refundedCents)}
            detail={count(s.refundedCount)}
            icon={TrendingDown}
            valueClassName="text-rose-600 dark:text-rose-400"
            iconClassName="bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400"
          />
          <MetricCard
            label="Chargebacks"
            value={money(s.chargebacksCents)}
            detail={count(s.chargebacksCount)}
            icon={AlertTriangle}
            valueClassName="text-orange-600 dark:text-orange-400"
            iconClassName="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
          />
        </>
      )}
      {coproducao && (
        <MetricCard
          label="Coprodução"
          value={reportMoney(coproducao.creditedCents)}
          detail={[
            `${coproducao.count.toLocaleString('pt-BR')} ${coproducao.count === 1 ? 'recebimento' : 'recebimentos'}`,
            coproducao.lockedCents > 0 &&
              `Em mediação ${reportMoney(coproducao.lockedCents)}`,
            coproducao.reversedCents > 0 &&
              `Estornado ${reportMoney(coproducao.reversedCents)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
          icon={HandCoins}
          valueClassName="text-emerald-600 dark:text-emerald-400"
          iconClassName="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
          tooltip="Participações de coprodução creditadas na sua carteira."
        />
      )}
      {afiliacao && afiliacao.count > 0 && (
        <MetricCard
          label="Afiliação"
          value={reportMoney(afiliacao.creditedCents)}
          detail={[
            `${afiliacao.count.toLocaleString('pt-BR')} ${afiliacao.count === 1 ? 'comissão' : 'comissões'}`,
            afiliacao.lockedCents > 0 &&
              `Pendente ${reportMoney(afiliacao.lockedCents)}`,
            afiliacao.reversedCents > 0 &&
              `Revertida ${reportMoney(afiliacao.reversedCents)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
          icon={Handshake}
          valueClassName="text-sky-600 dark:text-sky-400"
          iconClassName="bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400"
          tooltip="Comissões de afiliado creditadas na sua carteira, em vendas de outros proprietários."
        />
      )}
      {afiliados && afiliados.count > 0 && (
        <MetricCard
          label="Comissões de afiliados"
          value={reportMoney(afiliados.commissionCents)}
          detail={`${afiliados.count.toLocaleString('pt-BR')} ${afiliados.count === 1 ? 'venda com afiliado' : 'vendas com afiliado'}`}
          icon={Handshake}
          valueClassName="text-amber-600 dark:text-amber-400"
          iconClassName="bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
          tooltip="Quanto foi pago a afiliados nas suas vendas do período. Já está descontado do seu líquido e não é taxa."
        />
      )}
      {extra}
    </ReportMetricSection>
  );
}
