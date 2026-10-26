import SuccessPageComponent from '@/components/success/page';
import { Suspense } from 'react';

const SuccessPage = () => {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <SuccessPageComponent />
    </Suspense>
  );
};

export default SuccessPage;
