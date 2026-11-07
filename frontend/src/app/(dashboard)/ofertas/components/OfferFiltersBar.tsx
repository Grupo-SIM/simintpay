'use client';

import { FilterX } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import {
  emptyOfferFilters,
  hasActiveFilters,
  type OfferFilters,
} from '../offer-filters';
import {
  OFFER_KINDS,
  OFFER_METHODS,
  OFFER_STATUSES,
  kindLabels,
  methodLabels,
  renewalLabels,
  statusLabels,
  type OfferRenewal,
} from '../offers';

const ALL = 'all';
const RENEWALS: OfferRenewal[] = ['NONE', 'AUTO_CHARGE', 'MANUAL_PAY'];
const withAll = (
  label: string,
  options: { value: string; label: string }[],
) => [{ value: ALL, label }, ...options];

export function OfferFiltersBar({
  filters,
  theme,
  platforms,
  isAdmin = false,
  onChange,
}: {
  filters: OfferFilters;
  isAdmin?: boolean;
  theme: 'light' | 'dark';
  platforms: { value: string; label: string }[];
  onChange: (next: OfferFilters) => void;
}) {
  // Qualquer filtro volta para a primeira página.
  const change = (patch: Partial<OfferFilters>) =>
    onChange({ ...filters, ...patch, page: 1 });
  const [search, setSearch] = useDebouncedInput(filters.search, (value) =>
    change({ search: value }),
  );
  const [ownerSearch, setOwnerSearch] = useDebouncedInput(
    filters.ownerSearch,
    (value) => change({ ownerSearch: value }),
  );
  return (
    <div
      data-testid="offer-filters"
      className="grid gap-4 rounded-2xl border border-white/40 bg-zinc-50/50 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"
    >
      <Input
        label="Nome ou código"
        name="offer-search"
        placeholder="Ex: Mentoria"
        theme={theme}
        value={search}
        onChange={setSearch}
      />
      {isAdmin && (
        <Input
          label="Dono do link"
          name="offer-owner-search"
          placeholder="Nome ou e-mail"
          theme={theme}
          value={ownerSearch}
          onChange={setOwnerSearch}
        />
      )}
      <Dropdown
        label="Tipo"
        portal
        theme={theme}
        value={filters.kind || ALL}
        options={withAll(
          'Todos',
          OFFER_KINDS.map((kind) => ({ value: kind, label: kindLabels[kind] })),
        )}
        onChange={(value) =>
          change({ kind: value === ALL ? '' : (value as OfferFilters['kind']) })
        }
      />
      <Dropdown
        label="Status"
        portal
        theme={theme}
        value={filters.status || ALL}
        options={withAll(
          'Todos',
          OFFER_STATUSES.map((status) => ({
            value: status,
            label: statusLabels[status],
          })),
        )}
        onChange={(value) =>
          change({
            status: value === ALL ? '' : (value as OfferFilters['status']),
          })
        }
      />
      <Dropdown
        label="Plataforma"
        portal
        theme={theme}
        value={filters.platformTag || ALL}
        options={withAll('Todas', platforms)}
        onChange={(value) =>
          change({ platformTag: value === ALL ? '' : value })
        }
      />
      <Dropdown
        label="Meio de pagamento"
        portal
        theme={theme}
        value={filters.paymentMethod || ALL}
        options={withAll(
          'Todos',
          OFFER_METHODS.map((method) => ({
            value: method,
            label: methodLabels[method],
          })),
        )}
        onChange={(value) =>
          change({
            paymentMethod:
              value === ALL ? '' : (value as OfferFilters['paymentMethod']),
          })
        }
      />
      <Dropdown
        label="Recorrência"
        portal
        theme={theme}
        value={filters.renewalMode || ALL}
        options={withAll(
          'Todas',
          RENEWALS.map((mode) => ({ value: mode, label: renewalLabels[mode] })),
        )}
        onChange={(value) =>
          change({
            renewalMode:
              value === ALL ? '' : (value as OfferFilters['renewalMode']),
          })
        }
      />
      <ActionButton
        className="cursor-pointer self-end"
        disabled={!hasActiveFilters(filters)}
        // O campo de busca sincroniza sozinho quando o filtro volta a ficar vazio.
        onClick={() => onChange(emptyOfferFilters)}
      >
        <FilterX className="h-4 w-4" /> Limpar
      </ActionButton>
    </div>
  );
}
