'use client';

import { PlatformFilterSelect } from '@/components/product-platforms/PlatformFilterSelect';

import { Search, Trash2 } from 'lucide-react';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { DataColumnsDropdown } from '@/app/(dashboard)/relatorio/components/DataColumnsDropdown';
import { DateRangePickerField } from '@/app/(dashboard)/relatorio/components/DateRangePickerField';
import type { SubscriberFiltersState } from '../types';
import { SUBSCRIBER_TABLE_COLUMNS } from '../column-config';
import { SUBSCRIBER_PLATFORM_OPTIONS } from '../utils';

type Props = {
  fieldTheme: 'light' | 'dark';
  filters: SubscriberFiltersState;
  isFetching: boolean;
  columnSelectedMap: Record<string, boolean>;
  onToggleColumn: (key: string) => void;
  onChange: (next: Partial<SubscriberFiltersState>) => void;
  onClear: () => void;
  /** Contagem exibida ao lado da busca (ex.: filtros aplicados). */
  appliedFilterBadge?: number;
};

export function SubscribersFilters({
  fieldTheme,
  filters,
  isFetching,
  columnSelectedMap,
  onToggleColumn,
  onChange,
  onClear,
  appliedFilterBadge = 0,
}: Props) {
  const [localSearch, updateSearch] = useDebouncedInput(
    filters.search,
    (search) => onChange({ search }),
  );
  return (
    <div className="rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid w-full min-w-0 flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-5 lg:max-w-6xl">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm text-zinc-700 dark:text-white/70">
                Pesquisar assinante
              </span>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-zinc-300 px-1.5 text-[10px] font-semibold text-zinc-600 dark:border-white/20 dark:text-zinc-300">
                {appliedFilterBadge}
              </span>
            </div>
            <Input
              theme={fieldTheme}
              variant="navbar"
              name="subscriber-search"
              placeholder="Ex: Ana ou ana@empresa.com.br"
              value={localSearch}
              onChange={updateSearch}
            />
          </div>
          <PlatformFilterSelect
            label="Plataforma:"
            theme={fieldTheme}
            variant="navbar"
            portal
            value={filters.plataforma}
            onChange={(value) => onChange({ plataforma: value })}
            options={SUBSCRIBER_PLATFORM_OPTIONS}
          />
          <Dropdown
            label="Status"
            theme={fieldTheme}
            variant="navbar"
            value={filters.statusGroup}
            onChange={(statusGroup) => onChange({ statusGroup })}
            options={[
              { value: '', label: 'Todos' },
              { value: 'active', label: 'Ativas' },
              { value: 'paused', label: 'Pausadas' },
              { value: 'deactivated', label: 'Desativadas' },
            ]}
          />
          <Dropdown
            label="Intervalo"
            theme={fieldTheme}
            variant="navbar"
            value={filters.frequency}
            onChange={(frequency) => onChange({ frequency })}
            options={[
              { value: '', label: 'Todos' },
              { value: 'MONTHLY', label: 'Mensal' },
              { value: 'YEARLY', label: 'Anual' },
            ]}
          />
          <DateRangePickerField
            label="Primeira cobrança:"
            theme={fieldTheme}
            value={filters.dateRange}
            onChange={(dateRange) => onChange({ dateRange })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {isFetching && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Carregando...
            </span>
          )}
          <ActionButton variant="outline" onClick={onClear}>
            <Trash2 className="h-4 w-4" />
            Limpar tudo
          </ActionButton>
          <DataColumnsDropdown
            options={SUBSCRIBER_TABLE_COLUMNS}
            selectedMap={columnSelectedMap}
            onToggle={onToggleColumn}
          />
        </div>
      </div>
    </div>
  );
}
