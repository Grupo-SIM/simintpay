'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { filtersFromParams, offerRoutes } from '../offer-filters';
import { ProductEditState } from '../../cliente/components';
import { OfferFormScreen } from './OfferFormScreen';

function OfferFormRouteContent({ editId }: { editId: string | null }) {
  const router = useRouter();
  const filters = filtersFromParams(useSearchParams());
  const listHref = offerRoutes.list(filters);

  return (
    <OfferFormScreen
      editId={editId}
      listHref={listHref}
      onSaved={(id, { coproductionFailed }) =>
        // Co-produção que falhou na criação: abre a edição para tentar de novo.
        router.push(
          coproductionFailed ? offerRoutes.edit(id, filters) : listHref,
        )
      }
    />
  );
}

/** Tela do formulário de oferta (criar ou editar); os filtros da listagem vêm na querystring. */
export function OfferFormRoute({ editId }: { editId: string | null }) {
  return (
    <Suspense fallback={<ProductEditState loading retry={() => {}} />}>
      <OfferFormRouteContent editId={editId} />
    </Suspense>
  );
}
