import CheckoutRouter from '@/components/CheckoutRouter';
import { Suspense } from 'react';

export default function Home() {
  return (
    <div className="">
      <Suspense fallback={<div>Carregando...</div>}>
        <CheckoutRouter />
      </Suspense>
    </div>
  );
}
