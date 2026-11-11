'use client';

import { PlatformFilterSelect } from '@/components/product-platforms/PlatformFilterSelect';

import { Input } from '@/components/ui/Input';
import { usePlatformListOption } from '@/hooks/use-platform-list-option';
import { Dropdown } from '@/components/ui/Dropdown';
import type { LinkAssinaturaFilters } from '../types';

const PLATFORM_LABELS: Record<string, string> = {
  AREAFLIX: 'Áreaflix',
  EBOOK: 'EbookSim',
  ATLAS: 'AtlasHosting',
  PAGATG: 'PagaTG',
};

type Props = {
  fieldTheme: 'light' | 'dark';
  filters: LinkAssinaturaFilters;
  platformTags: string[];
  onChange: (next: Partial<LinkAssinaturaFilters>) => void;
};

export function LinksAssinaturaFilters({
  fieldTheme,
  filters,
  platformTags,
  onChange,
}: Props) {
  const platformOption = usePlatformListOption();
  return (
    <div className="rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          label="Código do link"
          placeholder="Ex: A1B2C3"
          value={filters.code}
          onChange={(value) => onChange({ code: value })}
          theme={fieldTheme}
          variant="navbar"
        />
        <Dropdown
          label="Frequência"
          value={filters.frequencyType}
          onChange={(value) =>
            onChange({
              frequencyType: value as LinkAssinaturaFilters['frequencyType'],
            })
          }
          theme={fieldTheme}
          variant="navbar"
          portal
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'WEEKLY', label: 'Semanal' },
            { value: 'MONTHLY', label: 'Mensal' },
            { value: 'ANUAL', label: 'Anual' },
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
    </div>
  );
}
