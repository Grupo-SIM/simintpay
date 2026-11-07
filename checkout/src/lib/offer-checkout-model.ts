export type OfferCheckoutPricing = {
  options: {
    installments: number;
    totalAmount: number;
    installmentAmount: number;
    interestAmount: number;
  }[];
  pixAmount: number;
  debitAmount: number;
  /** Total do boleto (cotação BOLETO); ausente em prévias antigas. */
  boletoAmount?: number;
};
export type OfferMethod = 'pix' | 'credit_card' | 'debit_card' | 'boleto';

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
  trialDays?: number | null;
  pricing?: OfferCheckoutPricing;
};

const METHOD_FROM_BACKEND: Record<string, OfferMethod> = {
  PIX: 'pix',
  CREDIT_CARD: 'credit_card',
  DEBIT_CARD: 'debit_card',
  BOLETO: 'boleto',
};

/** Meios que o endpoint de cobrança avulsa aceita, na ordem PIX > crédito > débito > boleto. */
export function availableMethods(offer: PublicOffer): OfferMethod[] {
  const accepted = new Set(
    offer.acceptedMethods
      .map((method) => METHOD_FROM_BACKEND[method])
      .filter(Boolean),
  );
  return (['pix', 'credit_card', 'debit_card', 'boleto'] as const).filter(
    (method) => accepted.has(method),
  );
}

export const offerAmount = (offer: PublicOffer) => offer.amountCents / 100;

export const isRecurringOffer = (offer: PublicOffer) =>
  offer.renewalMode !== 'NONE';

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

/** Endereço do pagador, como digitado (os mesmos campos do boleto legado). */
export type BoletoAddressFields = {
  cep: string;
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  complemento?: string;
};

/** Endereço no formato do `POST .../charge` (CEP só dígitos, UF maiúscula, textos aparados). */
export function boletoAddressBody(address: BoletoAddressFields) {
  return {
    cep: address.cep.replace(/\D/g, ''),
    rua: address.rua.trim(),
    numero: address.numero.trim(),
    bairro: address.bairro.trim(),
    cidade: address.cidade.trim(),
    uf: address.uf.trim().toUpperCase(),
    complemento: (address.complemento ?? '').trim(),
  };
}

/** Corpo de `POST /ofertas/public/:code/charge` (sem `tracking`). */
export function chargeBody(input: {
  method: OfferMethod;
  customer: { name: string; email: string; document: string; phone: string };
  installments: number;
  card?: Card;
  address?: BoletoAddressFields;
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
      : method === 'boleto'
        ? input.address
          ? boletoAddressBody(input.address)
          : {}
        : {
            installments: method === 'credit_card' ? input.installments : 1,
            card: input.card,
          }),
  };
}

/** Resposta de `POST .../charge` para boleto. */
export type BoletoResponse = {
  id?: string;
  transactionId?: string;
  status?: string;
  boletoUrl?: string | null;
  boletoDigitableLine?: string | null;
  boletoExpiresAt?: string | null;
  amount?: number;
};

export type BoletoResult = {
  /** Id do pagamento no gateway: chave do SSE/polling de status (`/checkout/pix/:id/...`). */
  paymentId: string | null;
  /** Valor realmente cobrado (R$), quando a API o informa. */
  amount: number | null;
  url: string | null;
  digitableLine: string | null;
  /** `YYYY-MM-DD` do gateway, ou null quando o boleto não tem vencimento. */
  dueDate: string | null;
};

/** Normaliza a resposta; null quando o gateway não devolveu link nem linha digitável. */
export function mapBoletoResponse(data: BoletoResponse): BoletoResult | null {
  const url = data.boletoUrl?.trim() || null;
  const digitableLine = data.boletoDigitableLine?.trim() || null;
  if (!url && !digitableLine) return null;
  return {
    paymentId: data.id ?? data.transactionId ?? null,
    amount: typeof data.amount === 'number' ? data.amount : null,
    url,
    digitableLine,
    dueDate: data.boletoExpiresAt?.trim() || null,
  };
}

/** `2026-12-10` (ou ISO completo) -> `10/12/2026`; devolve o texto original se não for data. */
export function formatBoletoDueDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** Aviso do boleto: com vencimento mostra a data; sem vencimento (0 dias) não inventa uma. */
export function boletoPaymentNotice(dueDate: string | null): string {
  const due = formatBoletoDueDate(dueDate);
  return due
    ? `Pague até ${due} e você receberá a confirmação por e-mail.`
    : 'Pague o boleto e você receberá a confirmação por e-mail.';
}
