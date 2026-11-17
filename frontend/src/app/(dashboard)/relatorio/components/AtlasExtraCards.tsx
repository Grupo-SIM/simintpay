'use client';

import { TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Tooltip as TooltipRadix } from 'radix-ui';
import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { endpoints } from '@/services/api/endpoints';
import { MetricCard } from './MetricCard';
import { ReportError } from './ReportError';
import { ReportMetricSection } from './ReportMetricSection';

type AtlasConsolidado = {
  custoDominio: number;
  custoHospedagem: number;
  lucroLiquidoDominio: number;
  lucroLiquidoVps: number;
  lucroAfiliado: number;
  totalRepasseAfiliado: number;
  lucroSimpayDeSaque: number;
  receitaLiquidaAtlas: number;
  saquePendente: number;
  roiDominios: number;
  roiHospedagem: number;
  roiAtlas: number;
  atlasApiAvailable: boolean;
};

function formatBRL(v: number | undefined | null) {
  return (v ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function AtlasExtraCards({
  filters,
}: {
  filters: Record<string, string | undefined>;
}) {
  const api = useReportApi();
  const { data, isLoading, isError, refetch } = useReportQuery({
    queryKey: ['atlasConsolidado', filters.startDate, filters.endDate],
    queryFn: ({ signal }) =>
      api.get<AtlasConsolidado>(endpoints.relatorios.atlasConsolidado, {
        query: {
          startDate: filters.startDate ?? undefined,
          endDate: filters.endDate ?? undefined,
        },
        signal,
      }),
  });

  if (isError) return <ReportError retry={() => void refetch()} />;

  return (
    <div className="flex flex-col gap-3">
      {data?.atlasApiAvailable === false && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400">
          Dados do Atlas indisponíveis no momento. Os valores abaixo podem estar
          incompletos.
        </div>
      )}
      <TooltipRadix.Provider delayDuration={200}>
        <ReportMetricSection title="Atlas — Domínios, Hospedagem e Afiliados">
          <MetricCard
            label="Custo Domínio"
            tooltip="Custo real do domínio na Namecheap, sem markup."
            value={isLoading ? 'Carregando...' : formatBRL(data?.custoDominio)}
            icon={TrendingDown}
            iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
            valueClassName="text-red-600 dark:text-red-400"
          />
          <MetricCard
            label="Custo Hospedagem"
            tooltip="Custo estimado do servidor na Contabo (50% do valor faturado)."
            value={
              isLoading ? 'Carregando...' : formatBRL(data?.custoHospedagem)
            }
            icon={TrendingDown}
            iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
            valueClassName="text-red-600 dark:text-red-400"
          />
          <MetricCard
            label="Lucro Líq. Domínio"
            tooltip="Lucro nos domínios: preço − custo Namecheap."
            value={
              isLoading ? 'Carregando...' : formatBRL(data?.lucroLiquidoDominio)
            }
            icon={TrendingUp}
            iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
            valueClassName={
              (data?.lucroLiquidoDominio ?? 0) >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }
          />
          <MetricCard
            label="Lucro Líq. VPS"
            tooltip="Lucro no VPS: preço − custo estimado Contabo."
            value={
              isLoading ? 'Carregando...' : formatBRL(data?.lucroLiquidoVps)
            }
            icon={TrendingUp}
            iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
            valueClassName={
              (data?.lucroLiquidoVps ?? 0) >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }
          />
          <MetricCard
            label="Total Pago a Afiliados"
            tooltip="Soma dos saques de afiliados aprovados no período."
            value={isLoading ? 'Carregando...' : formatBRL(data?.lucroAfiliado)}
            icon={Wallet}
            iconClassName="text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400"
          />
          <MetricCard
            label="Total Repasse Afiliado"
            tooltip="Comissões geradas no período, ainda disponíveis para saque."
            value={
              isLoading
                ? 'Carregando...'
                : formatBRL(data?.totalRepasseAfiliado)
            }
            icon={Wallet}
            iconClassName="text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400"
          />
          <MetricCard
            label="Lucro SimIntPay — Saque"
            tooltip="R$ 2 por saque de afiliado aprovado."
            value={
              isLoading ? 'Carregando...' : formatBRL(data?.lucroSimpayDeSaque)
            }
            icon={TrendingUp}
            iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
            valueClassName="text-green-600 dark:text-green-400"
          />
          <MetricCard
            label="Saque Pendente"
            tooltip="Saques de afiliados aguardando aprovação."
            value={
              isLoading
                ? 'Carregando...'
                : (data?.saquePendente ?? 0).toLocaleString('pt-BR')
            }
            icon={Wallet}
            iconClassName="text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400"
            valueClassName="text-yellow-600 dark:text-yellow-400"
          />
          <MetricCard
            label="Receita Líquida Atlas"
            tooltip="Lucro final do Atlas, já sem custos e comissões."
            value={
              isLoading ? 'Carregando...' : formatBRL(data?.receitaLiquidaAtlas)
            }
            icon={TrendingUp}
            iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
            valueClassName={
              (data?.receitaLiquidaAtlas ?? 0) >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }
          />
          <MetricCard
            label="ROI Domínios"
            tooltip="Lucro ÷ receita dos domínios."
            value={
              isLoading
                ? 'Carregando...'
                : `${(data?.roiDominios ?? 0).toFixed(2)}%`
            }
            icon={TrendingUp}
            iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
            valueClassName={
              (data?.roiDominios ?? 0) >= 0
                ? 'text-purple-600 dark:text-purple-400'
                : 'text-red-600 dark:text-red-400'
            }
          />
          <MetricCard
            label="ROI Hospedagem"
            tooltip="Lucro ÷ receita do VPS."
            value={
              isLoading
                ? 'Carregando...'
                : `${(data?.roiHospedagem ?? 0).toFixed(2)}%`
            }
            icon={TrendingUp}
            iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
            valueClassName={
              (data?.roiHospedagem ?? 0) >= 0
                ? 'text-purple-600 dark:text-purple-400'
                : 'text-red-600 dark:text-red-400'
            }
          />
          <MetricCard
            label="ROI Atlas"
            tooltip="Receita líquida ÷ receita bruta do Atlas."
            value={
              isLoading
                ? 'Carregando...'
                : `${(data?.roiAtlas ?? 0).toFixed(2)}%`
            }
            icon={TrendingUp}
            iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
            valueClassName={
              (data?.roiAtlas ?? 0) >= 0
                ? 'text-purple-600 dark:text-purple-400'
                : 'text-red-600 dark:text-red-400'
            }
          />
        </ReportMetricSection>
      </TooltipRadix.Provider>
    </div>
  );
}
