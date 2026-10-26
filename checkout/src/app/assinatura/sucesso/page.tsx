import AssinaturaSucessoComponent from '@/components/assinatura-sucesso/page';
import { Suspense } from 'react';

const AssinaturaSucessoPage = () => {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <AssinaturaSucessoComponent />
    </Suspense>
  );
};

export default AssinaturaSucessoPage;
