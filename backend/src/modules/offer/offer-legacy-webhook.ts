import { splitDocument } from '../../application/utils/document.util';
import type { PurchasedItem } from './offer-delivery';
import { offerWebhookUrl } from './offer-legacy-origin';
import { frequencyLabel, planTypeOf } from './legacy-links.compat';

/**
 * Offer-level webhook, same contract the legacy `PaymentLink`/`SubscriptionLink` webhook had:
 * POST JSON, amounts in reais, header `x-simpay-token`. The URL lives in `Offer.metadata.webhookUrl`
 * (the same place the platform plan import stores it); `Offer.fulfillment` rejects unknown keys.
 */
export type LegacyWebhookEvent =
  | 'purchase_approved'
  | 'purchase_refunded'
  | 'subscription_activated'
  | 'subscription_renewed'
  | 'subscription_expired';

/** Events the signed platform outbox also emits (so the same URL is served only once). */
export const SIGNED_OUTBOX_EVENTS: ReadonlySet<LegacyWebhookEvent> = new Set([
  'purchase_approved',
  'purchase_refunded',
  'subscription_activated',
]);

export { offerWebhookUrl };

type Money = { toString(): string } | number;

type OfferView = {
  id: string;
  name: string;
  intervalType: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | null;
  intervalCount: number | null;
};
type TxView = {
  id: string;
  amount: Money;
  netAmount: Money | null;
  paymentMethod: unknown;
  customerEmail?: string | null;
  customerName?: string | null;
  customerDocument?: string | null;
  customerPhone?: string | null;
};
type ChargeView = {
  customerEmail: string | null;
  customerName: string | null;
  customerDocument: string | null;
};

const reais = (value: Money) => Number(Number(value).toFixed(2));

function buyer(charge: ChargeView, tx: TxView) {
  return {
    customerEmail: tx.customerEmail ?? charge.customerEmail,
    customerName: tx.customerName ?? charge.customerName,
  };
}

/** `purchase_approved` / `purchase_refunded` of a payment link (`notifyPaymentLinkExternalWebhook`). */
export function purchaseWebhookBody(input: {
  event: 'purchase_approved' | 'purchase_refunded';
  offer: OfferView;
  charge: ChargeView;
  tx: TxView;
  /** Title of the funnel offer when only an upsell/downsell was bought; the link name otherwise. */
  planName: string;
  items: PurchasedItem[];
}) {
  const { offer, charge, tx } = input;
  return {
    event: input.event,
    ...buyer(charge, tx),
    planName: input.planName,
    items: input.items,
    paymentMethod: String(tx.paymentMethod),
    amountCharged: Number(tx.amount),
    netAmount: reais(tx.netAmount ?? tx.amount),
    orderId: tx.id,
    linkId: offer.id,
    ...splitDocument(tx.customerDocument ?? charge.customerDocument),
    phone: tx.customerPhone ?? undefined,
  };
}

/** `subscription_activated` and `subscription_renewed` (subscription link checkout and renewal). */
export function subscriptionWebhookBody(input: {
  event: 'subscription_activated' | 'subscription_renewed';
  offer: OfferView;
  charge: ChargeView;
  tx: TxView;
}) {
  const { offer, charge, tx } = input;
  return {
    event: input.event,
    ...buyer(charge, tx),
    planName: offer.name,
    paymentMethod: String(tx.paymentMethod),
    frequencyType: planTypeOf(frequencyLabel(offer)),
    amountCharged: Number(tx.amount),
    netAmount: reais(tx.netAmount ?? tx.amount),
    orderId: tx.id,
    linkId: offer.id,
    ...splitDocument(tx.customerDocument ?? charge.customerDocument),
    phone: tx.customerPhone ?? undefined,
  };
}

/** `subscription_expired` (cancelled contract): zero amounts, the contract id as `orderId`. */
export function subscriptionExpiredWebhookBody(input: {
  offer: OfferView;
  contract: {
    id: string;
    customerEmail: string | null;
    customerName: string | null;
  };
  /** Method of the last paid cycle; the legacy webhook hard-coded CREDIT_CARD. */
  paymentMethod?: unknown;
}) {
  const { offer, contract } = input;
  return {
    event: 'subscription_expired' as const,
    customerEmail: contract.customerEmail,
    customerName: contract.customerName,
    planName: offer.name,
    paymentMethod: String(input.paymentMethod ?? 'CREDIT_CARD'),
    frequencyType: planTypeOf(frequencyLabel(offer)),
    amountCharged: 0,
    netAmount: 0,
    orderId: contract.id,
    linkId: offer.id,
  };
}
