'use client';

import { Suspense } from 'react';
import { ProductEditState } from '../../components';
import { ProductForm } from './components';

export default function ProductPage() {
  return (
    <Suspense fallback={<ProductEditState loading retry={() => {}} />}>
      <ProductForm />
    </Suspense>
  );
}
