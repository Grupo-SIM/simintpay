'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  filtersFromParams,
  screenFromParams,
  screenHref,
  type OfferFilters,
} from './offer-filters';
import { OfferFormScreen } from './components/OfferFormScreen';
import { OfferListing } from './components/OfferListing';
import { ProductEditState } from '../cliente/components';

/** Tela única de ofertas: listagem com filtros e formulário (?novo=1 / ?editar=<id>). */
function OfertasScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const screen = screenFromParams(params);
  const filters = filtersFromParams(params);
  const go = (target: Parameters<typeof screenHref>[0], next = filters) =>
    router.push(screenHref(target, next));
  const listHref = screenHref({ mode: 'list' }, filters);

  if (screen.mode === 'list')
    return (
      <OfferListing
        filters={filters}
        onFiltersChange={(next: OfferFilters) =>
          router.replace(screenHref({ mode: 'list' }, next))
        }
        onCreate={() => go({ mode: 'create' })}
        onEdit={(id) => go({ mode: 'edit', id })}
      />
    );
  return (
    <OfferFormScreen
      editId={screen.mode === 'edit' ? screen.id : null}
      listHref={listHref}
      onSaved={(id, { coproductionFailed }) =>
        // Co-produção que falhou na criação: abre a edição para tentar de novo.
        router.push(
          coproductionFailed
            ? screenHref({ mode: 'edit', id }, filters)
            : listHref,
        )
      }
    />
  );
}

export default function OfertasPage() {
  return (
    <Suspense fallback={<ProductEditState loading retry={() => {}} />}>
      <OfertasScreen />
    </Suspense>
  );
}
