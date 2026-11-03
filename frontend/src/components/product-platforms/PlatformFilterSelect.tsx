'use client';

import type { ComponentProps } from 'react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { adminPlatformLabel } from '@/lib/product-platforms';

type Props = ComponentProps<typeof Dropdown> & {
  /** Omite o proprietário nos rótulos e ordena as plataformas alfabeticamente. */
  hideOwner?: boolean;
};

/** Filters include inactive and historical platforms; creation keeps its own active-only catalog. */
export function PlatformFilterSelect({ hideOwner, ...props }: Props) {
  const catalog = useProductPlatforms();
  const admin = Boolean(catalog.user?.isAdmin);
  const options = new Map(
    props.options.map((option) => [option.value.toUpperCase(), option]),
  );
  if (admin) {
    for (const platform of catalog.platforms) {
      const key = platform.tag.toUpperCase();
      const previous = options.get(key);
      options.set(key, {
        value: previous?.value ?? platform.tag,
        label: hideOwner
          ? `${platform.name}${platform.isActive ? '' : ' (Inativa)'}`
          : adminPlatformLabel(platform, catalog.user),
        selectedLabel: platform.name,
      });
    }
  }
  const sortedOptions = hideOwner
    ? [...options.values()].sort((a, b) =>
        a.value === ''
          ? -1
          : b.value === ''
            ? 1
            : a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }),
      )
    : [...options.values()];
  return (
    <div className="min-w-0">
      <Dropdown
        {...props}
        options={sortedOptions}
        value={
          props.value
            ? (options.get(props.value.toUpperCase())?.value ?? props.value)
            : props.value
        }
        searchable
        searchPlaceholder={
          hideOwner
            ? 'Buscar plataforma...'
            : 'Buscar plataforma ou proprietário...'
        }
        disabled={
          props.disabled || (admin && (catalog.isLoading || catalog.isError))
        }
      />
      {admin && catalog.isError && (
        <button
          type="button"
          className="mt-1 cursor-pointer rounded border px-2 py-1 text-xs text-red-500"
          onClick={catalog.retry}
        >
          Tentar carregar plataformas novamente
        </button>
      )}
    </div>
  );
}
