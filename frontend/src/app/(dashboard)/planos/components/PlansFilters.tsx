'use client';

import { PlatformFilterSelect } from '@/components/product-platforms/PlatformFilterSelect';

import { Trash2 } from 'lucide-react';
import { usePlatformListOption } from '@/hooks/use-platform-list-option';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { DataColumnsDropdown } from '@/app/(dashboard)/relatorio/components/DataColumnsDropdown';
import { DateRangePickerField } from '@/app/(dashboard)/relatorio/components/DateRangePickerField';
import type { PlanFiltersState } from '../types';
import { PLAN_TABLE_COLUMNS } from '../column-config';

const PLATFORM_LABELS: Record<string, string> = {
  AREAFLIX: 'Áreaflix',
  EBOOK: 'EbookSim',
  ATLAS: 'AtlasHosting',
  'CONTROLE-MOTORISTA': 'Controle de Motorista',
  'CONTROLE-PATRIMONIAL': 'Controle Patrimonial',
  PAGATG: 'PagaTG',
};

type Props = {
  fieldTheme: 'light' | 'dark';
  filters: PlanFiltersState;
  isFetching: boolean;
  platformTags: string[];
  columnSelectedMap: Record<string, boolean>;
  onToggleColumn: (key: string) => void;
  onChange: (next: Partial<PlanFiltersState>) => void;
  onClear: () => void;
};

export function PlansFilters({
  fieldTheme,
  filters,
  isFetching,
  platformTags,
  columnSelectedMap,
  onToggleColumn,
  onChange,
  onClear,
}: Props) {
  const platformOption = usePlatformListOption();
  return (
    <div className="rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="grid gap-3 md:grid-cols-4">
        <DateRangePickerField
          label="Data de criação"
          theme={fieldTheme}
          value={filters.dateRange}
          onChange={(dateRange) => onChange({ dateRange })}
        />
        <Input
          theme={fieldTheme}
          variant="navbar"
          label="Nome do plano"
          placeholder="Ex: Plano básico"
          value={filters.planName}
          onChange={(value) => onChange({ planName: value })}
        />
        <Dropdown
          theme={fieldTheme}
          variant="navbar"
          portal
          label="Status"
          value={filters.status}
          onChange={(value) => onChange({ status: value })}
          options={[
            { label: 'Todos', value: 'all' },
            { label: 'Ativo', value: 'Ativo' },
            { label: 'Inativo', value: 'Inativo' },
          ]}
        />
        <PlatformFilterSelect
          theme={fieldTheme}
          variant="navbar"
          portal
          label="Plataforma"
          value={filters.platform}
          onChange={(value) => onChange({ platform: value })}
          options={[
            { label: 'Todas', value: 'all' },
            ...platformTags.map((tag) =>
              platformOption(tag, PLATFORM_LABELS[tag.toUpperCase()] ?? tag),
            ),
          ]}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
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
          options={PLAN_TABLE_COLUMNS}
          selectedMap={columnSelectedMap}
          onToggle={onToggleColumn}
        />
      </div>
    </div>
  );
}
