import { acceptedMethodList } from '../../application/helpers/accepted-payment-methods.helper';
import { accessDaysForFrequency } from '../../application/helpers/billing-frequency.helper';

/**
 * Pure mappers from the five legacy products to `Offer` drafts (plan 0021, phase 4/5).
 * No I/O: callers read the rows and decide what to do with the drafts and issues.
 */

export type LegacyType =
  | 'PaymentLink'
  | 'SubscriptionLink'
  | 'Plan'
  | 'PixCreditPlan'
  | 'Boleto';
export type OfferKindValue =
  | 'PAYMENT_LINK'
  | 'SUBSCRIPTION_LINK'
  | 'PLAN'
  | 'PIX_PLAN'
  | 'BOLETO';
export type PaymentMethodValue =
  | 'PIX'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'BOLETO';
export type RenewalModeValue = 'NONE' | 'AUTO_CHARGE' | 'MANUAL_PAY';
export type IntervalTypeValue = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/** Decimal-like (Prisma Decimal, string, number). Float columns arrive as number. */
export type MoneyInput =
  | string
  | number
  | { toString(): string }
  | null
  | undefined;

export type OfferDraftIssue =
  | 'INVALID_AMOUNT'
  | 'MISSING_CODE'
  | 'MISSING_OWNER';

export type OfferDraft = {
  ownerUserId: string | null;
  createdByUserId: string | null;
  platformTag: string | null;
  code: string | null;
  kind: OfferKindValue;
  name: string;
  description: string | null;
  /** null when the legacy amount could not be converted exactly. */
  amountCents: number | null;
  isActive: boolean;
  acceptedMethods: PaymentMethodValue[];
  maxInstallments: number;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  accessDays: number | null;
  renewalMode: RenewalModeValue;
  intervalType: IntervalTypeValue | null;
  intervalCount: number | null;
  repetitions: number | null;
  retryDays: number | null;
  legacyType: LegacyType;
  legacyId: string;
  issues: OfferDraftIssue[];
};

/** Exact decimal (up to 2 places, no float arithmetic) to integer cents; null if not exact. */
export function toCents(value: MoneyInput): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  if (/[^0]/.test(fraction.slice(2))) return null;
  const cents =
    Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return sign ? -cents : cents;
}

type Interval = { type: IntervalTypeValue; count: number };

/** Calendar interval of a legacy `PlanType` (or similar) value; unknown defaults to monthly. */
export function intervalForFrequency(freq?: string | null): Interval {
  switch (
    String(freq ?? '')
      .toUpperCase()
      .trim()
  ) {
    case 'ANUAL':
    case 'ANNUAL':
    case 'YEAR':
      return { type: 'YEAR', count: 1 };
    case 'SEMESTRAL':
    case 'SEMESTER':
      return { type: 'MONTH', count: 6 };
    case 'TRIMESTRAL':
    case 'QUARTER':
      return { type: 'MONTH', count: 3 };
    case 'WEEKLY':
    case 'SEMANAL':
    case 'WEEK':
      return { type: 'WEEK', count: 1 };
    case 'DAILY':
    case 'DAY':
      return { type: 'DAY', count: 1 };
    default:
      return { type: 'MONTH', count: 1 };
  }
}

const clean = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
const firstTag = (tags?: string[] | null, fallback?: string | null) =>
  clean(tags?.find((t) => clean(t))) ?? clean(fallback);

function finish(draft: Omit<OfferDraft, 'issues'>): OfferDraft {
  const issues: OfferDraftIssue[] = [];
  if (draft.amountCents === null) issues.push('INVALID_AMOUNT');
  if (!draft.code) issues.push('MISSING_CODE');
  if (!draft.ownerUserId) issues.push('MISSING_OWNER');
  return { ...draft, issues };
}

type Common = {
  id: string;
  userId?: string | null;
  createdByUserId?: string | null;
};
const owners = (row: Common) => ({
  ownerUserId: clean(row.userId),
  createdByUserId: clean(row.createdByUserId) ?? clean(row.userId),
});

export type PaymentLinkRow = Common & {
  code?: string | null;
  title: string;
  description?: string | null;
  amount: MoneyInput;
  expiresAt?: Date | null;
  maxInstallments?: number | null;
  aceitaCartao?: boolean | null;
  aceitaDebito?: boolean | null;
  aceitaPix?: boolean | null;
  isActive?: boolean | null;
  maxUses?: number | null;
  currentUses?: number | null;
  plataformas?: string[] | null;
};

export function mapPaymentLink(row: PaymentLinkRow): OfferDraft {
  const methods: PaymentMethodValue[] = [];
  if (row.aceitaCartao ?? true) methods.push('CREDIT_CARD');
  if (row.aceitaDebito ?? true) methods.push('DEBIT_CARD');
  if (row.aceitaPix ?? true) methods.push('PIX');
  return finish({
    ...owners(row),
    platformTag: firstTag(row.plataformas),
    code: clean(row.code),
    kind: 'PAYMENT_LINK',
    name: row.title,
    description: row.description ?? null,
    amountCents: toCents(row.amount),
    isActive: row.isActive ?? true,
    acceptedMethods: methods,
    maxInstallments: row.maxInstallments ?? 1,
    expiresAt: row.expiresAt ?? null,
    maxUses: row.maxUses ?? null,
    usedCount: row.currentUses ?? 0,
    accessDays: null,
    renewalMode: 'NONE',
    intervalType: null,
    intervalCount: null,
    repetitions: null,
    retryDays: null,
    legacyType: 'PaymentLink',
    legacyId: row.id,
  });
}

export type SubscriptionLinkRow = Common & {
  code?: string | null;
  name: string;
  description?: string | null;
  amount: MoneyInput;
  frequencyType?: string | null;
  isActive?: boolean | null;
  maxUses?: number | null;
  currentUses?: number | null;
  paymentMethods?: string | null;
  platformTag?: string | null;
  plataformas?: string[] | null;
};

export function mapSubscriptionLink(row: SubscriptionLinkRow): OfferDraft {
  const interval = intervalForFrequency(row.frequencyType);
  return finish({
    ...owners(row),
    platformTag: firstTag(row.plataformas, row.platformTag),
    code: clean(row.code),
    kind: 'SUBSCRIPTION_LINK',
    name: row.name,
    description: row.description ?? null,
    amountCents: toCents(row.amount),
    isActive: row.isActive ?? true,
    acceptedMethods: acceptedMethodList(row.paymentMethods),
    maxInstallments: 1,
    expiresAt: null,
    maxUses: row.maxUses ?? null,
    usedCount: row.currentUses ?? 0,
    accessDays: accessDaysForFrequency(row.frequencyType),
    renewalMode: 'AUTO_CHARGE',
    intervalType: interval.type,
    intervalCount: interval.count,
    repetitions: null,
    retryDays: null,
    legacyType: 'SubscriptionLink',
    legacyId: row.id,
  });
}

export type PlanRow = Common & {
  code?: string | null;
  name: string;
  description?: string | null;
  price: MoneyInput;
  type?: string | null;
  repetitions?: number | null;
  retryDays?: number | null;
  isActive?: boolean | null;
  paymentMethods?: string | null;
  plataformas?: string[] | null;
};

export function mapPlan(row: PlanRow): OfferDraft {
  const interval = intervalForFrequency(row.type);
  return finish({
    ...owners(row),
    platformTag: firstTag(row.plataformas),
    code: clean(row.code),
    kind: 'PLAN',
    name: row.name,
    description: row.description ?? null,
    amountCents: toCents(row.price),
    isActive: row.isActive ?? true,
    acceptedMethods: acceptedMethodList(row.paymentMethods),
    maxInstallments: 1,
    expiresAt: null,
    maxUses: null,
    usedCount: 0,
    accessDays: accessDaysForFrequency(row.type),
    renewalMode: 'AUTO_CHARGE',
    intervalType: interval.type,
    intervalCount: interval.count,
    repetitions: row.repetitions ?? null,
    retryDays: row.retryDays ?? null,
    legacyType: 'Plan',
    legacyId: row.id,
  });
}

export type PixCreditPlanRow = Common & {
  /** PixCreditPlan has no public code column; pass one only if the caller resolved it. */
  code?: string | null;
  type?: string | null;
  /** Float column in the legacy schema; its shortest decimal form is used. */
  price: MoneyInput;
  description?: string | null;
  status?: string | null;
  tenantTag?: string | null;
};

export function mapPixCreditPlan(row: PixCreditPlanRow): OfferDraft {
  const interval = intervalForFrequency(row.type);
  return finish({
    ...owners(row),
    platformTag: clean(row.tenantTag),
    code: clean(row.code),
    kind: 'PIX_PLAN',
    name: clean(row.description) ?? `PIX ${row.type ?? 'MONTHLY'}`,
    description: row.description ?? null,
    amountCents: toCents(row.price),
    isActive: (row.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE',
    acceptedMethods: ['PIX'],
    maxInstallments: 1,
    expiresAt: null,
    maxUses: null,
    usedCount: 0,
    accessDays: accessDaysForFrequency(row.type),
    renewalMode: 'MANUAL_PAY',
    intervalType: interval.type,
    intervalCount: interval.count,
    repetitions: null,
    retryDays: null,
    legacyType: 'PixCreditPlan',
    legacyId: row.id,
  });
}

export type BoletoRow = Common & {
  code?: string | null;
  title: string;
  description?: string | null;
  amount: MoneyInput;
  expiresAt?: Date | null;
  isActive?: boolean | null;
  maxUses?: number | null;
  currentUses?: number | null;
  plataformas?: string[] | null;
};

export function mapBoleto(row: BoletoRow): OfferDraft {
  return finish({
    ...owners(row),
    platformTag: firstTag(row.plataformas),
    code: clean(row.code),
    kind: 'BOLETO',
    name: row.title,
    description: row.description ?? null,
    amountCents: toCents(row.amount),
    isActive: row.isActive ?? true,
    acceptedMethods: ['BOLETO'],
    maxInstallments: 1,
    expiresAt: row.expiresAt ?? null,
    maxUses: row.maxUses ?? null,
    usedCount: row.currentUses ?? 0,
    accessDays: null,
    renewalMode: 'NONE',
    intervalType: null,
    intervalCount: null,
    repetitions: null,
    retryDays: null,
    legacyType: 'Boleto',
    legacyId: row.id,
  });
}
