'use client';

import type { ReactNode } from 'react';
import { CustomSelect } from '@/components/ui/CustomSelect';
import type { DateRange } from '../types';
import { DateRangePickerField } from './DateRangePickerField';
import { reportMethod } from './report-types';

export function ReportFilterFields({
  theme,
  range,
  onRangeChange,
  platform,
  method,
  onMethodChange,
  children,
}: {
  theme: 'light' | 'dark';
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  platform?: ReactNode;
  method?: string;
  onMethodChange?: (method: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white/70 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div
        className={`grid items-end gap-4 ${platform && onMethodChange ? 'lg:grid-cols-3' : 'lg:grid-cols-1'}`}
      >
        {platform}
        <DateRangePickerField
          theme={theme}
          label="Período"
          value={range}
          onChange={onRangeChange}
        />
        {onMethodChange && (
          <CustomSelect
            label="Método de pagamento"
            value={method ?? 'all'}
            onChange={onMethodChange}
            options={[
              { value: 'all', label: 'Todos' },
              ...Object.entries(reportMethod).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        )}
      </div>
      {children}
    </div>
  );
}
