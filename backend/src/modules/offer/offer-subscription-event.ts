import { frequencyLabel, planTypeOf } from './legacy-links.compat';

type Money = { toString(): string } | number;

/**
 * Body of the legacy `subscription_activated` webhook for an offer: same fields as
 * `checkout-subscription-link-card` (amounts in reais, `linkId` = the offer id, `planName` = the
 * offer name), plus the outbox ids. The buyer document is left out, like every platform outbox
 * payload.
 */
export function subscriptionActivatedPayload(input: {
  offer: {
    id: string;
    name: string;
    intervalType: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | null;
    intervalCount: number | null;
  };
  charge: {
    id: string;
    contractId: string | null;
    customerEmail: string | null;
    customerName: string | null;
  };
  tx: {
    id: string;
    amount: Money;
    netAmount: Money | null;
    paymentMethod: unknown;
    customerPhone?: string | null;
  };
}): Record<string, unknown> {
  const { offer, charge, tx } = input;
  const amount = Number(tx.amount);
  const net = Number(Number(tx.netAmount ?? tx.amount).toFixed(2));
  return {
    customerEmail: charge.customerEmail,
    customerName: charge.customerName,
    planName: offer.name,
    paymentMethod: String(tx.paymentMethod),
    frequencyType: planTypeOf(frequencyLabel(offer)),
    amountCharged: amount,
    netAmount: net,
    amountCents: Math.round(amount * 100),
    netAmountCents: Math.round(net * 100),
    orderId: tx.id,
    offerId: offer.id,
    chargeId: charge.id,
    contractId: charge.contractId,
    linkId: offer.id,
    phone: tx.customerPhone ?? undefined,
  };
}
