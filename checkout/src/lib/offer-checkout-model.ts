export type OfferMethod = 'pix' | 'credit_card' | 'debit_card';

/** Campos de `GET /ofertas/public/:code` usados pelo checkout. */
export type PublicOffer = {
  code: string;
  name: string;
  description: string | null;
  amountCents: number;
  acceptedMethods: string[];
  maxInstallments: number;
  renewalMode: 'NONE' | 'AUTO_CHARGE' | 'MANUAL_PAY';
  intervalType: string | null;
  intervalCount: number | null;
};

const METHOD_FROM_BACKEND: Record<string, OfferMethod> = {
  PIX: 'pix',
  CREDIT_CARD: 'credit_card',
  DEBIT_CARD: 'debit_card',
};

/** Meios que o endpoint de cobrança avulsa aceita (boleto fica de fora), na ordem PIX > crédito > débito. */
export function availableMethods(offer: PublicOffer): OfferMethod[] {
  const accepted = new Set(
    offer.acceptedMethods
      .map((method) => METHOD_FROM_BACKEND[method])
      .filter(Boolean),
  );
  return (['pix', 'credit_card', 'debit_card'] as const).filter((method) =>
    accepted.has(method),
  );
}

export const offerAmount = (offer: PublicOffer) => offer.amountCents / 100;

export const isRecurringOffer = (offer: PublicOffer) =>
  offer.renewalMode !== 'NONE';

export function recurrenceNotice(offer: PublicOffer): string {
  return offer.renewalMode === 'MANUAL_PAY'
    ? 'Esta oferta é recorrente e a renovação por PIX ainda não está disponível. Volte em breve ou fale com o vendedor.'
    : 'Esta oferta é uma assinatura e a cobrança recorrente ainda não está disponível. Volte em breve ou fale com o vendedor.';
}

const DECLINED = [
  'FAILED',
  'REJECTED',
  'EXPIRED',
  'DECLINED',
  'REFUNDED',
  'CHARGEBACK',
];
export const isDeclined = (status: unknown) =>
  DECLINED.includes(String(status ?? '').toUpperCase());

type Card = Record<string, string | undefined>;

/** Corpo de `POST /ofertas/public/:code/charge` (sem `tracking`). */
export function chargeBody(input: {
  method: OfferMethod;
  customer: { name: string; email: string; document: string; phone: string };
  installments: number;
  card?: Card;
}) {
  const { method, customer } = input;
  return {
    paymentMethod: method,
    customerName: customer.name,
    customerEmail: customer.email,
    customerDocument: customer.document,
    customerPhone: customer.phone,
    documentType: customer.document.length === 14 ? 'CNPJ' : 'CPF',
    ...(method === 'pix'
      ? {}
      : {
          installments: method === 'credit_card' ? input.installments : 1,
          card: input.card,
        }),
  };
}
