'use client';

import { Fragment } from 'react';
import { PlatformOwnerSelect } from '@/components/platforms/PlatformOwnerSelect';
import { ProductPlatformSelect } from '@/components/product-platforms/ProductPlatformSelect';
import type { useProductPlatforms } from '@/hooks/use-product-platforms';
import { ProductFormSection } from './ProductFormSection';

type Props = {
  catalog: ReturnType<typeof useProductPlatforms>;
  value: string | null;
  onChange: (value: string) => void;
  theme: 'light' | 'dark';
  embedded?: boolean;
};

export function ProductPlatformSection({ embedded, ...props }: Props) {
  const content = (
    <Fragment>
      <div className="space-y-2">
        <p className="text-sm text-zinc-500">
          {props.catalog.user?.isAdmin
            ? 'Selecione um proprietário ou uma plataforma para definir o destino financeiro do produto.'
            : 'Selecione o destino financeiro cujas taxas serão aplicadas ao produto.'}{' '}
          <span className="text-red-500" aria-label="Obrigatório">
            *
          </span>
        </p>
        <div className="grid items-start gap-4 md:grid-cols-2">
          {props.catalog.user?.isAdmin && !props.value && (
            <PlatformOwnerSelect
              owner={props.catalog.financialOwner}
              disabled={false}
              required={false}
              onChange={props.catalog.setFinancialOwner}
            />
          )}
          <ProductPlatformSelect
            {...props}
            onChange={(tag) => {
              props.catalog.setFinancialOwner(null);
              props.onChange(tag);
            }}
          />
        </div>
      </div>
    </Fragment>
  );
  return embedded ? (
    content
  ) : (
    <ProductFormSection title="Plataforma">{content}</ProductFormSection>
  );
}
