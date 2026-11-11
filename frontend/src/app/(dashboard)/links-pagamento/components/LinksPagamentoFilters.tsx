'use client';

import { PlatformFilterSelect } from '@/components/product-platforms/PlatformFilterSelect';

import { usePlatformListOption } from '@/hooks/use-platform-list-option';
import { Input } from '@/components/ui/Input';
import type { LinkPagamentoFilters } from '../types';

const PLATFORM_LABELS: Record<string, string> = {
  AREAFLIX: 'Áreaflix',
  EBOOK: 'EbookSim',
  ATLAS: 'AtlasHosting',
  PAGATG: 'PagaTG',
  REVALIDA: 'Revalida',
};

type Props = {
  fieldTheme: 'light' | 'dark';
  filters: LinkPagamentoFilters;
  platformTags: string[];
  onChange: (next: Partial<LinkPagamentoFilters>) => void;
};

export function LinksPagamentoFilters({
  fieldTheme,
  filters,
  platformTags,
  onChange,
}: Props) {
  const platformOption = usePlatformListOption();
  return (
    <div className="rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Título do link"
          placeholder="Ex: Meu link de pagamento"
          value={filters.titulo}
          onChange={(value) => onChange({ titulo: value })}
          theme={fieldTheme}
          variant="navbar"
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
