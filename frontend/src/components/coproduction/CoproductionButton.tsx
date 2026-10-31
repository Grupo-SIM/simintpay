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
}: {
  product: CoproductionProduct;
  productId?: string | null;
  draft?: Coproducer[];
  onDraftChange?: (participants: Coproducer[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-fit cursor-pointer disabled:cursor-not-allowed"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Users className="h-4 w-4" />
        Co-produção{!productId && draft.length > 0 ? ` (${draft.length})` : ''}
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
