'use client';

import { Eraser, Search } from 'lucide-react';
import type { DateRange, PeriodPreset } from '../types';
import { ActionButton } from './ActionButton';
import { ReportFilterFields } from './ReportFilterFields';

type Props = {
  fieldTheme: 'light' | 'dark';
  periodPreset: PeriodPreset;
  customDateRange: DateRange;
  effectiveDateRange: DateRange;
  onPeriodChange: (next: {
    preset: PeriodPreset;
    customRange?: DateRange;
  }) => void;
  isFetching: boolean;
  detalharLucro: boolean;
  onDetalharLucroChange: (v: boolean) => void;
  onClear: () => void;
  onSearch: () => void;
};

export function ReportFilters(props: Props) {
  return (
    <ReportFilterFields
      theme={props.fieldTheme}
      range={props.effectiveDateRange}
      onRangeChange={(customRange) =>
        props.onPeriodChange({ preset: 'custom', customRange })
      }
    >
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-zinc-200/60 pt-4 dark:border-white/10">
        <ActionButton variant="danger" onClick={props.onClear}>
          <Eraser className="h-4 w-4" />
          Limpar filtros
        </ActionButton>
        <ActionButton variant="primary" onClick={props.onSearch}>
          <Search className="h-4 w-4" />
          {props.isFetching ? 'Pesquisando...' : 'Pesquisar'}
        </ActionButton>
      </div>
    </ReportFilterFields>
  );
}
