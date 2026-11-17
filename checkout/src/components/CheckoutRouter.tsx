'use client';
import { useSearchParams } from 'next/navigation';
import CreditCardForm from '@/components/card/creditCardForm';
import OfferCheckout from '@/components/ofertas/OfferCheckout';
import OfferRenewal from '@/components/ofertas/OfferRenewal';
import { CheckoutFooter } from '@/components/checkout/CheckoutChrome';
import { CheckoutUiCard } from '@/components/checkout/CheckoutUiCard';
import { AlertCircle } from 'lucide-react';

// Os parâmetros dos links antigos (simLinkCode, simPlanCode, code, data, ...) são redirecionados para
// `?oferta=` em `proxy.ts`. O que sobra é o pagamento direto dos sistemas vizinhos (CreditCardForm).
const DIRECT_CHECKOUT_PARAMS = ['value', 'orderId', 'id'];

function InvalidCheckoutLink() {
  return (
    <div className="checkout-page-bg flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <CheckoutUiCard
          variant="danger"
          title="Link de pagamento inválido"
          className="w-full max-w-md text-center"
        >
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-400" />
          <p className="text-sm text-red-100/90">
            Este link não contém os dados do pagamento. Solicite um novo link ao
            vendedor.
          </p>
        </CheckoutUiCard>
      </div>
      <CheckoutFooter />
    </div>
  );
}

export default function CheckoutRouter() {
  const searchParams = useSearchParams();
  const oferta = searchParams.get('oferta');

  if (oferta) {
    if (searchParams.has('renovar')) return <OfferRenewal />;
    return <OfferCheckout />;
  }

  const hasCheckoutData = DIRECT_CHECKOUT_PARAMS.some((param) =>
    Boolean(searchParams.get(param)),
  );

  if (!hasCheckoutData) {
    return <InvalidCheckoutLink />;
  }

  return <CreditCardForm />;
}
