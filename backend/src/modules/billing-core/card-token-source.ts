import type { PaymentMethod } from '@prisma/client';
import type { IPaymentGateway } from '../../core/services/payment-gateway.interface';

/**
 * Where the reusable card token of a recurring offer comes from. Raw card data (PAN/CVV)
 * only travels inside `chargeFirstCycle` in memory for the single gateway call: it is never
 * persisted, logged or returned. Implementations return only the acquirer token.
 */
export const CARD_TOKEN_SOURCE = Symbol('CARD_TOKEN_SOURCE');

export type CardTokenSourceKind = 'subscription' | 'card-token';

export type RawCard = {
  /** Single-use frontend token (kept for the legacy shape; not reusable). */
  token: string;
  number: string;
  cvv: string;
  exp_month: string;
  exp_year: string;
  holder_name: string;
  holder_document: string;
  brand?: string;
  bin?: string;
};

export type FirstCardChargeInput = {
  gateway: IPaymentGateway;
  domToken: string;
  acquirerCode: string;
  offer: {
    id: string;
    name: string;
    intervalType: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | null;
    intervalCount: number | null;
  };
  contractId: string;
  /** Gross amount charged to the buyer on the first cycle, in currency units. */
  amount: number;
  description: string;
  /** Link id on the acquirer, used by sources that charge through the payment-link path. */
  domLinkId: string;
  customer: {
    name: string;
    email: string;
    document: string;
    phone: string;
    documentType: 'CPF' | 'CNPJ';
  };
  card: RawCard;
};

export type FirstCardChargeResult = {
  /** Acquirer payment id used to match later webhooks. */
  paymentId: string;
  status?: string;
  /** Reusable token when the acquirer already returned it; null otherwise (use `fetchToken` once paid). */
  token: string | null;
};

export interface CardTokenSource {
  readonly kind: CardTokenSourceKind;
  /** Charges the first cycle with the raw card and, when possible, obtains the reusable token. */
  chargeFirstCycle(input: FirstCardChargeInput): Promise<FirstCardChargeResult>;
  /** Token of a contract whose first charge was paid after `chargeFirstCycle` returned. */
  fetchToken(input: {
    gateway: IPaymentGateway;
    domToken: string;
    acquirerCode: string;
    contractId: string;
  }): Promise<string | null>;
}

const PAID_STATUS = new Set([
  'paid',
  'approved',
  'captured',
  'completed',
  'authorized',
  'active',
]);
const REFUSED_STATUS = new Set([
  'refused',
  'denied',
  'declined',
  'failed',
  'canceled',
  'cancelled',
  'rejected',
  'error',
  'expired',
]);

/** Acquirer status of the first charge -> definitive result; anything else stays pending. */
export function firstChargeOutcome(
  status: string | null | undefined,
): 'PAID' | 'FAILED' | 'PENDING' {
  const s = (status ?? '').trim().toLowerCase();
  if (PAID_STATUS.has(s)) return 'PAID';
  if (REFUSED_STATUS.has(s)) return 'FAILED';
  return 'PENDING';
}

export const CARD_METHODS: readonly PaymentMethod[] = [
  'CREDIT_CARD',
  'DEBIT_CARD',
];

export function cardTokenSourceKindFromEnv(
  value = process.env.OFFER_CARD_TOKEN_SOURCE,
): CardTokenSourceKind {
  return value === 'card-token' ? 'card-token' : 'subscription';
}

/** Expiry month/year (4-digit year) from the buyer's payload. */
export function parseExpiry(
  month: string,
  year: string,
): { expMonth: number; expYear: number } | null {
  const expMonth = Number.parseInt(month, 10);
  let expYear = Number.parseInt(year, 10);
  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) return null;
  if (!Number.isInteger(expYear)) return null;
  if (expYear < 100) expYear += 2000;
  return { expMonth, expYear };
}
