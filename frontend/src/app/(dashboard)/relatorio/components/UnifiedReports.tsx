'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { useTheme } from 'next-themes';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { CoproductionReceipts } from '@/components/coproduction/CoproductionReceipts';
import { ReportsLayout } from './ReportsLayout';
import { ReportFilterFields } from './ReportFilterFields';
import { ReportPlatformSelect } from './ReportPlatformSelect';
import { OwnedReportContent } from './OwnedReportContent';
import { ReportSkeleton } from './ReportSkeleton';
import type { ReportPlatform } from './report-types';
import type { DateRange } from '../types';

const AdminOverview = dynamic(() => import('./AdminReportOverview'), {
  loading: () => <ReportSkeleton />,
});
const PlatformDetails = dynamic(
  () =>
    import('./ProdutoReportSection').then(
      (module) => module.ProdutoReportSection,
    ),
  { loading: () => <ReportSkeleton /> },
);
const AdminTransactions = dynamic(
  () =>
    import('./AdminReportTransactions').then(
      (module) => module.AdminReportTransactions,
    ),
  { loading: () => <ReportSkeleton /> },
);
const Balances = dynamic(
  () =>
    import('./PlatformBalancesView').then(
      (module) => module.PlatformBalancesView,
    ),
  { loading: () => <ReportSkeleton /> },
);
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
  const [tab, setTab] = useState('relatorios');
  const [platform, setPlatform] = useState<ReportPlatform | null>(null);
  const [range, setRange] = useState<DateRange>(currentPeriod);
  const [method, setMethod] = useState('all');
  const [accessLost, setAccessLost] = useState(false);
  const clearSelection = useCallback(() => {
    setPlatform(null);
    setAccessLost(true);
  }, []);
  const filters = {
    platform: platform?.tag,
    startDate: ymd(range.start),
    endDate: ymd(range.end),
    paymentMethod: method === 'all' ? undefined : method,
  };
  const admin = !!user?.isAdmin;
  return (
    <ReportsLayout activeTab={tab} onTabChange={setTab} admin={admin}>
      {tab === 'saldos' && admin ? (
        <Balances />
      ) : (
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
                  setPlatform(null);
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
            platform ? (
              <PlatformDetails
                key={`${platform.id}:${filters.startDate}:${filters.endDate}:${method}`}
                platform={platform}
                effectiveDateRange={range}
                method={method}
              />
            ) : (
              <div className="space-y-6">
                <AdminOverview range={range} method={method} />
                <AdminTransactions
                  key={`${filters.startDate}:${filters.endDate}:${method}`}
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  method={method}
                />
              </div>
            )
          ) : (
            <OwnedReportContent
              key={platform?.id ?? 'all'}
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
      )}
    </ReportsLayout>
  );
}
