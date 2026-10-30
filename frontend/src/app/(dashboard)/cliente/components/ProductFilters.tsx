'use client';

import { PlatformFilterSelect } from '@/components/product-platforms/PlatformFilterSelect';

import { platformLabel } from '@/components/ui/platform-label';
import { FilterX } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';

export type ProductFiltersState = {
  search: string;
  status: string;
  platform: string;
  start: string;
  end: string;
};
export const emptyProductFilters: ProductFiltersState = {
  search: '',
  status: 'all',
  platform: 'all',
  start: '',
  end: '',
};

export function ProductFilters({
  filters,
  theme,
  platforms,
  onChange,
}: {
  filters: ProductFiltersState;
  theme: 'light' | 'dark';
  platforms: string[];
  onChange: (next: ProductFiltersState) => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useDebouncedInput(filters.search, (value) =>
    onChange({ ...filters, search: value }),
  );
  return (
    <div className="grid gap-4 rounded-2xl border border-white/40 bg-zinc-50/50 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
      <Input
        label="Nome ou título"
        name="product-search"
        placeholder="Ex: Plano mensal"
        theme={theme}
        value={search}
        onChange={setSearch}
      />
      <PlatformFilterSelect
        label="Plataforma"
        portal
        theme={theme}
        value={filters.platform}
        options={[
          { value: 'all', label: 'Todas' },
          ...platforms.map((tag) => ({
            value: tag,
            label: platformLabel(tag),
          })),
        ]}
        onChange={(platform) => onChange({ ...filters, platform })}
      />
      <Dropdown
        label="Status"
        portal
        theme={theme}
        value={filters.status}
        options={[
          { value: 'all', label: 'Todos' },
          { value: 'active', label: 'Ativo' },
          { value: 'inactive', label: 'Inativo' },
        ]}
        onChange={(status) => onChange({ ...filters, status })}
      />
      <Input
        type="date"
        label="Criado de"
        name="created-from"
        placeholder="2026-10-01"
        theme={theme}
        value={filters.start}
        onChange={(start) => onChange({ ...filters, start })}
      />
      <Input
        type="date"
        label="Criado até"
        name="created-to"
        placeholder="2026-10-31"
        theme={theme}
        value={filters.end}
        onChange={(end) => onChange({ ...filters, end })}
      />
      <ActionButton
        className="cursor-pointer self-end"
        onClick={() => {
          setSearch('');
          onChange(emptyProductFilters);
          toast({ type: 'info', title: 'Filtros limpos' });
        }}
      >
        <FilterX className="h-4 w-4" /> Limpar
      </ActionButton>
    </div>
  );
}
