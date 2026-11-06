'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type {
  Coproducer,
  CoproductionProduct,
} from '@/features/coproduction/types';
import { CoproductionDialog } from './CoproductionDialog';
import { CoproductionDraftDialog } from './CoproductionDraftDialog';

export function CoproductionButton({
  product,
  productId,
  draft = [],
  onDraftChange,
  disabled = false,
  iconOnly = false,
}: {
  product: CoproductionProduct;
  productId?: string | null;
  draft?: Coproducer[];
  onDraftChange?: (participants: Coproducer[]) => void;
  disabled?: boolean;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
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
        aria-label={iconOnly ? 'Co-produção' : undefined}
        title={iconOnly ? 'Co-produção' : undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Users aria-hidden className="h-4 w-4" />
        {!iconOnly && (
          <>
            Co-produção
            {!productId && draft.length > 0 ? ` (${draft.length})` : ''}
          </>
        )}
      </Button>
      {open &&
        (productId ? (
          <CoproductionDialog
            product={product}
            productId={productId}
            onClose={() => setOpen(false)}
          />
        ) : onDraftChange ? (
          <CoproductionDraftDialog
            participants={draft}
            onChange={onDraftChange}
            onClose={() => setOpen(false)}
          />
        ) : null)}
    </>
  );
}
