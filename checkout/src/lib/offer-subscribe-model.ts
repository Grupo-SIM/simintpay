import type { PublicOffer } from './offer-checkout-model';

/** Meios do checkout de assinatura. Cartão só renova sozinho em AUTO_CHARGE; PIX vale em toda oferta recorrente. */
export type SubscribeMethod = 'pix' | 'credit_card';

export function subscribeMethods(offer: PublicOffer): SubscribeMethod[] {
  if (offer.renewalMode !== 'AUTO_CHARGE' && offer.renewalMode !== 'MANUAL_PAY')
    return [];
  const methods: SubscribeMethod[] = [];
  if (
    offer.renewalMode === 'AUTO_CHARGE' &&
    offer.acceptedMethods.includes('CREDIT_CARD')
  )
    methods.push('credit_card');
  // Teste grátis não cobra hoje: exige o cartão guardado, PIX não tem como começar.
  if (offer.acceptedMethods.includes('PIX') && !(offer.trialDays! > 0))
    methods.push('pix');
  return methods;
}

const UNITS: Record<string, [string, string, string]> = {
  DAY: ['dia', 'dias', 'Diário'],
  WEEK: ['semana', 'semanas', 'Semanal'],
  MONTH: ['mês', 'meses', 'Mensal'],
  YEAR: ['ano', 'anos', 'Anual'],
};

function unitOf(offer: PublicOffer) {
  const unit = UNITS[offer.intervalType ?? 'MONTH'] ?? UNITS.MONTH;
  const count =
    offer.intervalCount && offer.intervalCount > 0 ? offer.intervalCount : 1;
  return { unit, count };
}

/** "a cada mês", "a cada 3 meses", "a cada ano". */
export function intervalPhrase(offer: PublicOffer): string {
  const { unit, count } = unitOf(offer);
  return count === 1 ? `a cada ${unit[0]}` : `a cada ${count} ${unit[1]}`;
}

/** Rótulo curto da frequência para o cartão do pedido. */
export function frequencyLabel(offer: PublicOffer): string {
  const { unit, count } = unitOf(offer);
  return count === 1 ? unit[2] : `Recorrente, ${intervalPhrase(offer)}`;
}

export const trialDaysOf = (offer: PublicOffer) =>
  offer.trialDays && offer.trialDays > 0 ? offer.trialDays : 0;

const dateBr = (date: Date) =>
  date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

export function firstChargeDate(offer: PublicOffer, now = new Date()): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + trialDaysOf(offer));
  return date;
}

/** Texto do teste grátis; `null` quando a oferta não tem trial. */
export function trialNotice(
  offer: PublicOffer,
  now = new Date(),
): string | null {
  const days = trialDaysOf(offer);
  if (!days) return null;
  return `Teste grátis de ${days} ${days === 1 ? 'dia' : 'dias'}. Nenhuma cobrança hoje: a primeira será em ${dateBr(firstChargeDate(offer, now))}.`;
}

/** Como a renovação funciona. `money` já formatado (ex.: "R$ 49,90"). */
export function renewalNotice(
  offer: PublicOffer,
  money: string,
  method: SubscribeMethod = offer.renewalMode === 'AUTO_CHARGE'
    ? 'credit_card'
    : 'pix',
): string {
  const base = `${money} ${intervalPhrase(offer)}`;
  return method === 'credit_card'
    ? `${base}, cobrado automaticamente no cartão.`
    : `${base}. Você receberá um aviso e pagará o PIX a cada ciclo.`;
}

export function consentText(offer: PublicOffer, money: string): string {
  return `Autorizo a cobrança automática de ${money} ${intervalPhrase(offer)} no meu cartão, até eu cancelar.`;
}

export const cardLast4 = (number: string) =>
  number.replace(/\D/g, '').slice(-4);

/** Valida MM/AA digitados e devolve os campos como o backend os espera. */
export function parseCardExpiry(month: string, year: string, now = new Date()) {
  const m = Number.parseInt(month, 10);
  let y = Number.parseInt(year, 10);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y))
    return null;
  if (y < 100) y += 2000;
  const expired =
    y < now.getFullYear() ||
    (y === now.getFullYear() && m < now.getMonth() + 1);
  return { month: String(m).padStart(2, '0'), year: String(y), expired };
}

type Customer = {
  name: string;
  email: string;
  document: string;
  phone?: string;
};

/** Corpo de `POST /ofertas/public/:code/card-customer`. */
export function cardCustomerBody(customer: Customer) {
  return {
    customerName: customer.name,
    customerEmail: customer.email,
    customerDocument: customer.document,
    ...(customer.phone ? { customerPhone: customer.phone } : {}),
  };
}

export type TokenizedCard = { token?: string; brand?: string; bin?: string };

/**
 * Corpo de `POST /ofertas/public/:code/subscribe`. O cartão entra só como token + metadados de
 * exibição: número, CVV e documento do titular nunca saem do navegador (a API recusa com 400).
 */
export function subscribeBody(input: {
  method: SubscribeMethod;
  customer: Customer;
  card?: {
    tokenized: TokenizedCard;
    customerId: string;
    last4: string;
    expMonth: string;
    expYear: string;
    holderName: string;
  };
  tracking?: Record<string, string>;
  voucherCode?: string;
}) {
  const { method, customer, card } = input;
  return {
    ...(input.voucherCode ? { voucherCode: input.voucherCode } : {}),
    paymentMethod: method,
    customerName: customer.name,
    customerEmail: customer.email,
    customerDocument: customer.document,
    ...(customer.phone ? { customerPhone: customer.phone } : {}),
    documentType: customer.document.length === 14 ? 'CNPJ' : 'CPF',
    ...(input.tracking ? { tracking: input.tracking } : {}),
    ...(method === 'credit_card' && card
      ? {
          card: {
            token: card.tokenized.token,
            customerId: card.customerId,
            last4: card.last4,
            exp_month: card.expMonth,
            exp_year: card.expYear,
            holder_name: card.holderName,
            ...(card.tokenized.brand ? { brand: card.tokenized.brand } : {}),
            ...(card.tokenized.bin ? { bin: card.tokenized.bin } : {}),
          },
        }
      : {}),
  };
}

export type SubscribeResponse = {
  contractId: string;
  chargeId: string | null;
  transactionId: string | null;
  existing: boolean;
  contractStatus: string;
  chargeStatus: string;
  renewalMode: string;
  amount: number;
  nextChargeAt: string | null;
  cardSaved: boolean;
  pix: {
    pixContent: string | null;
    qrCode: string | null;
    pixExpire: string | null;
  } | null;
  redirectUrl: string | null;
};

type Done = {
  amount: number;
  nextChargeAt: string | null;
  existing: boolean;
  redirectUrl: string | null;
};

export type SubscribeOutcome =
  | {
      kind: 'pix';
      transactionId: string | null;
      pixContent: string | null;
      qrCode: string | null;
      pixExpire: string | null;
    }
  | ({ kind: 'trial' } & Done)
  | ({ kind: 'paid' } & Done);

/** Traduz a resposta do `subscribe` na próxima tela do checkout. */
export function mapSubscribeResponse(
  data: SubscribeResponse,
): SubscribeOutcome {
  if (data.pix && data.chargeStatus === 'PENDING')
    return { kind: 'pix', transactionId: data.transactionId, ...data.pix };
  const common = {
    amount: Number(data.amount) || 0,
    nextChargeAt: data.nextChargeAt,
    existing: data.existing,
    redirectUrl: data.redirectUrl,
  };
  return data.chargeStatus === 'TRIAL'
    ? { kind: 'trial', ...common }
    : { kind: 'paid', ...common };
}

export type SubscribeFailure = { message: string; retryable: boolean };

/** Mensagem amigável para 400/404/409 e demais falhas; `retryable` = o comprador pode tentar de novo. */
export function mapSubscribeError(
  status: number,
  data?: { message?: unknown },
): SubscribeFailure {
  const message = typeof data?.message === 'string' ? data.message : '';
  if (status === 404)
    return {
      message: 'Esta oferta não está mais disponível.',
      retryable: false,
    };
  if (status === 409)
    return {
      message:
        'Você já tem uma assinatura encerrada ou suspensa nesta oferta. Entre em contato com o suporte.',
      retryable: false,
    };
  if (status === 400 && message === 'Pagamento recusado')
    return {
      message: 'Pagamento recusado. Confira os dados ou use outro cartão.',
      retryable: true,
    };
  if (status === 400)
    return {
      message: message || 'Confira os dados informados e tente novamente.',
      retryable: true,
    };
  return {
    message: 'Erro ao processar a assinatura. Tente novamente.',
    retryable: true,
  };
}
