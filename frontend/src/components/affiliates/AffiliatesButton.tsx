'use client';

import { useState } from 'react';
import { Handshake } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { AffiliateProduct } from '@/features/affiliates/types';
import { AffiliatesDialog } from './AffiliatesDialog';

export function AffiliatesButton({
  product,
  productId,
  disabled = false,
  iconOnly = false,
}: {
  product: AffiliateProduct;
  /** Sem id (oferta ainda não criada) o botão fica desabilitado. */
  productId?: string | null;
  disabled?: boolean;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const unsaved = !productId;
  const hint = unsaved ? 'Salve a oferta para configurar afiliados' : undefined;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={
          iconOnly
            ? 'cursor-pointer disabled:cursor-not-allowed'
            : 'w-fit cursor-pointer disabled:cursor-not-allowed'
        }
        size={iconOnly ? 'icon-sm' : 'default'}
        aria-label={iconOnly ? 'Afiliados' : undefined}
        title={hint ?? (iconOnly ? 'Afiliados' : undefined)}
        disabled={disabled || unsaved}
        onClick={() => setOpen(true)}
      >
        <Handshake aria-hidden className="h-4 w-4" />
        {!iconOnly && 'Afiliados'}
      </Button>
      {open && productId && (
        <AffiliatesDialog
          product={product}
          productId={productId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
