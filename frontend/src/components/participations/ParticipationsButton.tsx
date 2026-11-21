'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CoproductionDraftDialog } from '@/components/coproduction/CoproductionDraftDialog';
import type { Coproducer } from '@/features/coproduction/types';
import {
  ParticipationsDialog,
  type ParticipationsProduct,
} from './ParticipationsDialog';

/** Botão único de co-produção e afiliados; sem id (oferta nova) abre só o rascunho de coprodutores. */
export function ParticipationsButton({
  product,
  productId,
  draft = [],
  onDraftChange,
  disabled = false,
  iconOnly = false,
}: {
  product: ParticipationsProduct;
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
        aria-label={iconOnly ? 'Participações' : undefined}
        title={iconOnly ? 'Participações: co-produção e afiliados' : undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Users aria-hidden className="h-4 w-4" />
        {!iconOnly && (
          <>
            Participações
            {!productId && draft.length > 0 ? ` (${draft.length})` : ''}
          </>
        )}
      </Button>
      {open &&
        (productId ? (
          <ParticipationsDialog
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
