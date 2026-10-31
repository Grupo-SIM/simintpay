'use client';

import type { ComponentProps } from 'react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { adminPlatformLabel } from '@/lib/product-platforms';

type Props = ComponentProps<typeof Dropdown>;

/** Filters include inactive and historical platforms; creation keeps its own active-only catalog. */
export function PlatformFilterSelect(props: Props) {
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
        label: adminPlatformLabel(platform, catalog.user),
        selectedLabel: platform.name,
      });
    }
  }
  return (
    <div className="min-w-0">
      <Dropdown
        {...props}
        options={[...options.values()]}
        value={
          props.value
            ? (options.get(props.value.toUpperCase())?.value ?? props.value)
            : props.value
        }
        searchable
        searchPlaceholder="Buscar plataforma ou proprietário..."
        disabled={
          props.disabled || (admin && (catalog.isLoading || catalog.isError))
        }
      />
      {admin && catalog.isLoading && (
        <p role="status" className="mt-1 text-xs text-zinc-500">
          Carregando plataformas…
        </p>
      )}
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
