'use client';
import { useSearchParams } from 'next/navigation';
import CreditCardForm from '@/components/card/creditCardForm';
import SimPlanCheckout from '@/components/simplan/SimPlanCheckout';
import SimLinkCheckout from '@/components/simlink/SimLinkCheckout';
import SimPixPlanCheckout from '@/components/simpixplan/SimPixPlanCheckout';
import SimSubscriptionLinkCheckout from '@/components/simsubscriptionlink/SimSubscriptionLinkCheckout';
import SimBoletoCheckout from '@/components/simboleto/SimBoletoCheckout';

export default function CheckoutRouter() {
  const searchParams = useSearchParams();
  const simPlanCode = searchParams.get('simPlanCode');
  const simLinkCode = searchParams.get('simLinkCode');
  const simBoletoCode = searchParams.get('simBoletoCode');
  const subscriptionLinkCode = searchParams.get('subscriptionLinkCode');
  const code = searchParams.get('code');

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

  return <CreditCardForm />;
}
