'use client';
import { useSearchParams } from 'next/navigation';
import CreditCardForm from '@/components/card/creditCardForm';
import SimPlanCheckout from '@/components/simplan/SimPlanCheckout';
import SimLinkCheckout from '@/components/simlink/SimLinkCheckout';
import SimPixPlanCheckout from '@/components/simpixplan/SimPixPlanCheckout';
import SimSubscriptionLinkCheckout from '@/components/simsubscriptionlink/SimSubscriptionLinkCheckout';
import OfferCheckout from '@/components/ofertas/OfferCheckout';
import SimBoletoCheckout from '@/components/simboleto/SimBoletoCheckout';
import { CheckoutFooter } from '@/components/checkout/CheckoutChrome';
import { CheckoutUiCard } from '@/components/checkout/CheckoutUiCard';
import { AlertCircle } from 'lucide-react';

// Parâmetros que identificam o que está sendo cobrado no fluxo genérico (CreditCardForm).
const GENERIC_CHECKOUT_PARAMS = [
  'linkCode',
  'subscriptionCode',
  'data',
  'value',
  'orderId',
  'id',
];

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
  const simPlanCode = searchParams.get('simPlanCode');
  const simLinkCode = searchParams.get('simLinkCode');
  const simBoletoCode = searchParams.get('simBoletoCode');
  const subscriptionLinkCode = searchParams.get('subscriptionLinkCode');
  const ofertaCode = searchParams.get('ofertaCode');
  const code = searchParams.get('code');

  if (ofertaCode) {
    return <OfferCheckout />;
  }

  if (simPlanCode) {
    return <SimPlanCheckout />;
  }

  if (simBoletoCode) {
    return <SimBoletoCheckout />;
  }

  if (simLinkCode) {
    return <SimLinkCheckout />;
  }

  if (subscriptionLinkCode) {
    return <SimSubscriptionLinkCheckout />;
  }

  if (code && (/^PX-/i.test(code) || /^PX_/i.test(code))) {
    return <SimPixPlanCheckout />;
  }

  const hasCheckoutData =
    Boolean(code) ||
    GENERIC_CHECKOUT_PARAMS.some((param) => Boolean(searchParams.get(param)));

  if (!hasCheckoutData) {
    return <InvalidCheckoutLink />;
  }

  return <CreditCardForm />;
}
