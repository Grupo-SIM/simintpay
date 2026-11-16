import type {
  OfferCheckoutPricing,
  OfferMethod,
  PublicBump,
  PublicOffer,
} from './offer-checkout-model';

/** Etapas do funil pós-compra; `done` = encerrado (ou inexistente). */
export type FunnelStage = 'upsell' | 'downsell' | 'done';

/** Meios em que o funil de um clique funciona (boleto não confirma na hora). */
export const FUNNEL_METHODS: OfferMethod[] = [
  'pix',
  'credit_card',
  'debit_card',
];

/** Oferta ligada à principal com o papel pedido (`Offer.fulfillment.bumps`, via GET público). */
export const funnelOfferOf = (
  offer: PublicOffer,
  role: 'UPSELL' | 'DOWNSELL',
): PublicBump | null =>
  offer.renewalMode === 'NONE'
    ? ((offer.bumps ?? []).find((bump) => bump.role === role) ?? null)
    : null;

/** Primeira etapa após o pagamento aprovado do pedido principal. */
export function firstFunnelStage(
  offer: PublicOffer,
  method: OfferMethod,
  parentChargeId: string | null,
): FunnelStage {
  if (!parentChargeId || !FUNNEL_METHODS.includes(method)) return 'done';
  return funnelOfferOf(offer, 'UPSELL') ? 'upsell' : 'done';
}

/** Recusar o upsell oferece o downsell (se houver); o resto encerra o funil. */
export function nextFunnelStage(
  offer: PublicOffer,
  stage: FunnelStage,
  accepted: boolean,
): FunnelStage {
  if (stage === 'upsell' && !accepted && funnelOfferOf(offer, 'DOWNSELL'))
    return 'downsell';
  return 'done';
}

/** A oferta do funil precisa aceitar o meio já usado no pedido principal. */
export const acceptsFunnelMethod = (
  funnelOffer: { acceptedMethods: string[] },
  method: OfferMethod,
) => funnelOffer.acceptedMethods.includes(method.toUpperCase());

/** Valor cobrado do comprador no meio do pedido principal (cartão sempre à vista). */
export function funnelPrice(
  pricing: OfferCheckoutPricing,
  method: OfferMethod,
): number {
  if (method === 'pix') return pricing.pixAmount;
  if (method === 'debit_card') return pricing.debitAmount;
  return (
    pricing.options.find((option) => option.installments === 1)?.totalAmount ??
    pricing.pixAmount
  );
}

/** Corpo de `POST /ofertas/public/:code/charge` do upsell/downsell. */
export function funnelChargeBody(input: {
  method: OfferMethod;
  parentChargeId: string;
  customer: { name: string; email: string; document: string; phone: string };
  card?: Record<string, string | undefined>;
}) {
  const { method, customer } = input;
  return {
    paymentMethod: method,
    parentChargeId: input.parentChargeId,
    customerName: customer.name,
    customerEmail: customer.email,
    customerDocument: customer.document,
    customerPhone: customer.phone,
    documentType: customer.document.length === 14 ? 'CNPJ' : 'CPF',
    ...(method === 'pix' ? {} : { installments: 1, card: input.card }),
  };
}
