'use client';

import { Fragment } from 'react';
import { PlatformOwnerSelect } from '@/components/platforms/PlatformOwnerSelect';
import { ProductPlatformSelect } from '@/components/product-platforms/ProductPlatformSelect';
import { HelpTooltip } from '@/components/ui/HelpTooltip';
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
        {props.catalog.user?.isAdmin ? (
          <p className="text-sm text-zinc-500">
            Selecione um proprietário ou uma plataforma para definir o destino
            financeiro do produto.{' '}
            <span className="text-red-500" aria-label="Obrigatório">
              *
            </span>
          </p>
        ) : (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <span>Escolher uma plataforma é opcional.</span>
            <HelpTooltip label="O que é uma plataforma?">
              Plataforma é o destino financeiro cujas taxas serão aplicadas ao
              produto. Se você não escolher nenhuma, as vendas vão para o seu
              CPF; se escolher uma, os valores seguem as taxas e o repasse dessa
              plataforma.
            </HelpTooltip>
          </div>
        )}
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
