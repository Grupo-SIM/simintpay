'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  filtersFromParams,
  offerRoutes,
  type OfferFilters,
} from './offer-filters';
import { OfferListing } from './components/OfferListing';
import { ProductEditState } from '../cliente/components';

function OfertasScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const filters = filtersFromParams(params);

  return (
    <OfferListing
      filters={filters}
      onFiltersChange={(next: OfferFilters) =>
        router.replace(offerRoutes.list(next))
      }
      onCreate={() => router.push(offerRoutes.create(filters))}
      onEdit={(id) => router.push(offerRoutes.edit(id, filters))}
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
