'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { useTheme } from 'next-themes';
import { useQueryClient } from '@tanstack/react-query';
import { consolidadoTagFor } from '@/lib/consolidado-tag';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { CoproductionReceipts } from '@/components/coproduction/CoproductionReceipts';
import { ReportsLayout } from './ReportsLayout';
import { ReportFilterFields } from './ReportFilterFields';
import { ReportPlatformSelect } from './ReportPlatformSelect';
import { AtlasExtraCards } from './AtlasExtraCards';
import { OwnedReportContent } from './OwnedReportContent';
import { OwnedReportSeries } from './OwnedReportSeries';
import { ReportSkeleton } from './ReportSkeleton';
import type { ReportPlatform } from './report-types';
import type { DateRange } from '../types';

const AdminOverview = dynamic(() => import('./AdminReportOverview'), {
  loading: () => <ReportSkeleton />,
});
const currentPeriod = (): DateRange => {
  const now = new Date();
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
};
const ymd = (date: Date | null) =>
  date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : undefined;

export function UnifiedReports() {
  const { user } = useCurrentUser();
  const { resolvedTheme } = useTheme();
  const client = useQueryClient();
  const { toast } = useToast();
  const [platform, setPlatform] = useState<ReportPlatform[]>([]);
  const [range, setRange] = useState<DateRange>(currentPeriod);
  const [method, setMethod] = useState('all');
  const [accessLost, setAccessLost] = useState(false);
  const clearSelection = useCallback(() => {
    setPlatform([]);
    setAccessLost(true);
  }, []);
  const filters = {
    platform: platform.length
      ? platform.map((item) => item.tag).join(',')
      : undefined,
    startDate: ymd(range.start),
    endDate: ymd(range.end),
    paymentMethod: method === 'all' ? undefined : method,
  };
  const admin = !!user?.isAdmin;
  return (
    <ReportsLayout admin={admin}>
      <>
        <ReportFilterFields
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          range={range}
          onRangeChange={setRange}
          method={method}
          onMethodChange={setMethod}
          platform={
            <ReportPlatformSelect
              value={platform}
              onChange={(value) => {
                setAccessLost(false);
                setPlatform(value);
              }}
              allowAll
            />
          }
        >
          <div className="mt-4 flex flex-wrap justify-end gap-3 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setPlatform([]);
                setRange(currentPeriod());
                setMethod('all');
                toast({ type: 'info', title: 'Filtros restaurados' });
              }}
            >
              Limpar filtros
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void client.invalidateQueries({
                  queryKey: ['reports', user?.id],
                });
                toast({ type: 'info', title: 'Atualizando relatório' });
              }}
            >
              Pesquisar
            </Button>
          </div>
        </ReportFilterFields>
        {accessLost && (
          <p role="alert" className="text-sm text-amber-600">
            Acesso à plataforma mudou. Selecione uma plataforma disponível.
          </p>
        )}
        {admin ? (
          platform.length ? (
            <div className="space-y-4">
              <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                {platform.map((item) => item.name).join(', ')}
              </h2>
              <div
                key={`${platform.map((item) => item.id).join(',')}:${filters.startDate}:${filters.endDate}:${method}`}
                className="space-y-6"
              >
                <AdminOverview
                  range={range}
                  method={method}
                  platform={filters.platform}
                />
                {platform.length === 1 &&
                  consolidadoTagFor(platform[0].tag) === 'ATLAS' && (
                    <AtlasExtraCards filters={filters} />
                  )}
                <OwnedReportSeries filters={filters} kind="mensal" />
                <div className="grid gap-4 xl:grid-cols-2">
                  <OwnedReportSeries filters={filters} kind="metodos" />
                  <OwnedReportSeries filters={filters} kind="status" />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <AdminOverview range={range} method={method} />
            </div>
          )
        ) : (
          <OwnedReportContent
            key={filters.platform ?? 'all'}
            filters={filters}
            onAccessLost={clearSelection}
          />
        )}
        {!admin && (
          <CoproductionReceipts
            key={JSON.stringify(filters)}
            filters={filters}
          />
        )}
      </>
    </ReportsLayout>
  );
}
