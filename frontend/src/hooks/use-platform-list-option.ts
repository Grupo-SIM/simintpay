'use client';

import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { adminPlatformLabel } from '@/lib/product-platforms';

export function usePlatformListOption() {
  const catalog = useProductPlatforms();
  return (tag: string, name: string) => {
    const platform = catalog.platforms.find(
      (row) => row.tag.toUpperCase() === tag.toUpperCase(),
    );
    return {
      value: tag,
      selectedLabel: platform?.name ?? name,
      label: catalog.user?.isAdmin
        ? catalog.isLoading
          ? `${name} — Carregando proprietário…`
          : adminPlatformLabel(
              platform ?? { name, isActive: true },
              catalog.user,
            )
        : name,
    };
  };
}
