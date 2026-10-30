'use client';

import { ProductPlatformSelect } from '@/components/product-platforms/ProductPlatformSelect';
import type { useProductPlatforms } from '@/hooks/use-product-platforms';
import { ProductFormSection } from './ProductFormSection';

type Props = {
  catalog: ReturnType<typeof useProductPlatforms>;
  value: string | null;
  onChange: (value: string) => void;
  theme: 'light' | 'dark';
};

export function ProductPlatformSection(props: Props) {
  return (
    <ProductFormSection title="Plataforma">
      <div className="space-y-2">
        <p className="text-sm text-zinc-500">
          Selecione a plataforma cujas taxas serão aplicadas ao produto.{' '}
          <span className="text-red-500" aria-label="Obrigatório">
            *
          </span>
        </p>
        <ProductPlatformSelect {...props} />
      </div>
    </ProductFormSection>
  );
}
