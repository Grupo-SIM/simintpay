import { acceptedMethodList } from '../../application/helpers/accepted-payment-methods.helper';
import { accessDaysForFrequency } from '../../application/helpers/billing-frequency.helper';
import {
  OfferFulfillmentError,
  parseOfferFulfillment,
} from './offer-fulfillment';

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
  | 'INVALID_BOLETO_DUE_DAYS'
  | 'INVALID_FULFILLMENT'
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
  /** Non-empty legacy webhookUrl/redirectUrl/emailBody, validated; null when none is set. */
  fulfillment: OfferDraftFulfillment | null;
  /** Boleto only: `boletoDueDays` and `requiresBuyerAddress`. */
  metadata: Record<string, unknown> | null;
  legacyType: LegacyType;
  legacyId: string;
  issues: OfferDraftIssue[];
  /** Reasons for INVALID_FULFILLMENT / INVALID_BOLETO_DUE_DAYS, never silently dropped. */
  issueDetails: string[];
  /** Non-blocking observations (e.g. extra legacy codes that were not chosen). */
  notes: string[];
};

export type OfferDraftFulfillment = {
  webhookUrl?: string;
  redirectUrl?: string;
  emailBody?: string;
};

/** The three legacy columns that become `Offer.fulfillment`. */
type FulfillmentSource = {
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  emailBody?: string | null;
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

/** Builds the validated fulfillment (SSRF checks included) or the reasons it was refused. */
export function buildFulfillment(source: FulfillmentSource): {
  fulfillment: OfferDraftFulfillment | null;
  errors: string[];
} {
  const raw: Record<string, string> = {};
  for (const key of ['webhookUrl', 'redirectUrl', 'emailBody'] as const) {
    const value = clean(source[key]);
    if (value) raw[key] = value;
  }
  if (!Object.keys(raw).length) return { fulfillment: null, errors: [] };
  try {
    const parsed = parseOfferFulfillment(raw);
    const fulfillment: OfferDraftFulfillment = {};
    if (parsed.webhookUrl) fulfillment.webhookUrl = parsed.webhookUrl;
    if (parsed.redirectUrl) fulfillment.redirectUrl = parsed.redirectUrl;
    if (parsed.emailBody) fulfillment.emailBody = parsed.emailBody;
    return { fulfillment, errors: [] };
  } catch (error) {
    if (error instanceof OfferFulfillmentError)
      return { fulfillment: null, errors: error.issues };
    throw error;
  }
}

type DraftInput = Omit<
  OfferDraft,
  'issues' | 'notes' | 'fulfillment' | 'metadata' | 'issueDetails'
>;

function finish(
  draft: DraftInput,
  notes: string[] = [],
  source: FulfillmentSource = {},
  extra: {
    metadata?: Record<string, unknown> | null;
    issues?: OfferDraftIssue[];
    details?: string[];
  } = {},
): OfferDraft {
  const built = buildFulfillment(source);
  const issues: OfferDraftIssue[] = [...(extra.issues ?? [])];
  const issueDetails = [...(extra.details ?? [])];
  if (built.errors.length) {
    issues.push('INVALID_FULFILLMENT');
    issueDetails.push(...built.errors.map((e) => `INVALID_FULFILLMENT: ${e}`));
  }
  if (draft.amountCents === null) issues.push('INVALID_AMOUNT');
  if (!draft.code) issues.push('MISSING_CODE');
  if (!draft.ownerUserId) issues.push('MISSING_OWNER');
  return {
    ...draft,
    fulfillment: built.fulfillment,
    metadata: extra.metadata ?? null,
    issues,
    issueDetails,
    notes,
  };
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
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  emailBody?: string | null;
};

export function mapPaymentLink(row: PaymentLinkRow): OfferDraft {
  const methods: PaymentMethodValue[] = [];
  if (row.aceitaCartao ?? true) methods.push('CREDIT_CARD');
  if (row.aceitaDebito ?? true) methods.push('DEBIT_CARD');
  if (row.aceitaPix ?? true) methods.push('PIX');
  return finish(
    {
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
    },
    [],
    row,
  );
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
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  emailBody?: string | null;
};

export function mapSubscriptionLink(row: SubscriptionLinkRow): OfferDraft {
  const interval = intervalForFrequency(row.frequencyType);
  return finish(
    {
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
    },
    [],
    row,
  );
}

export type PlanRow = Common & {
  code?: string | null;
  name: string;
  description?: string | null;
  price: MoneyInput;
  type?: string | null;
  /**
   * Gateway multiplier: the plan charges every `frequency` units of `type`
   * ("a cada N semanas/meses/anos", sent as DOM `frequency` + `frequency_type`).
   * Null/invalid is treated as 1.
   */
  frequency?: number | null;
  repetitions?: number | null;
  retryDays?: number | null;
  isActive?: boolean | null;
  paymentMethods?: string | null;
  plataformas?: string[] | null;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  emailBody?: string | null;
};

export function mapPlan(row: PlanRow): OfferDraft {
  const base = intervalForFrequency(row.type);
  // `Plan.frequency` multiplies the interval of `type` (create-plan.use-case.ts sends it
  // as DOM `frequency` next to `frequency_type`), so every 2 MONTHLY = 2 months.
  const multiplier =
    Number.isInteger(row.frequency) && Number(row.frequency) >= 1
      ? Number(row.frequency)
      : 1;
  const interval = { type: base.type, count: base.count * multiplier };
  return finish(
    {
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
      accessDays: accessDaysForFrequency(row.type) * multiplier,
      renewalMode: 'AUTO_CHARGE',
      intervalType: interval.type,
      intervalCount: interval.count,
      repetitions: row.repetitions ?? null,
      retryDays: row.retryDays ?? null,
      legacyType: 'Plan',
      legacyId: row.id,
    },
    [],
    row,
  );
}

export type PixPlanLinkCodeRow = {
  code: string;
  isActive?: boolean | null;
  createdAt?: Date | null;
};

/** Oldest active code wins; the others are reported as a note. */
export function pickPixPlanCode(linkCodes?: PixPlanLinkCodeRow[] | null): {
  code: string | null;
  notes: string[];
} {
  const active = (linkCodes ?? [])
    .filter((c) => (c.isActive ?? true) && clean(c.code))
    .sort(
      (a, b) =>
        (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
        a.code.localeCompare(b.code),
    );
  if (!active.length) return { code: null, notes: [] };
  const extras = active.slice(1).map((c) => c.code);
  return {
    code: clean(active[0].code),
    notes: extras.length
      ? [`EXTRA_ACTIVE_LINK_CODES: ${extras.join(', ')}`]
      : [],
  };
}

export type PixCreditPlanRow = Common & {
  /** Public checkout codes (`PX-...`) from `PixPlanLinkCode`; the plan has no code column. */
  linkCodes?: PixPlanLinkCodeRow[] | null;
  type?: string | null;
  /** Float column in the legacy schema; its shortest decimal form is used. */
  price: MoneyInput;
  description?: string | null;
  status?: string | null;
  tenantTag?: string | null;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  emailBody?: string | null;
};

export function mapPixCreditPlan(row: PixCreditPlanRow): OfferDraft {
  const interval = intervalForFrequency(row.type);
  const picked = pickPixPlanCode(row.linkCodes);
  return finish(
    {
      ...owners(row),
      platformTag: clean(row.tenantTag),
      code: picked.code,
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
    },
    picked.notes,
    row,
  );
}

export type BoletoRow = Common & {
  code?: string | null;
  title: string;
  description?: string | null;
  amount: MoneyInput;
  expiresAt?: Date | null;
  /** Days until the boleto is due (0-90, 0 = no due date). Null/undefined = column default 3. */
  vencimentoDias?: number | null;
  isActive?: boolean | null;
  maxUses?: number | null;
  currentUses?: number | null;
  plataformas?: string[] | null;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  emailBody?: string | null;
};

export function mapBoleto(row: BoletoRow): OfferDraft {
  const dueDays = row.vencimentoDias ?? 3;
  const validDueDays =
    Number.isInteger(dueDays) && dueDays >= 0 && dueDays <= 90;
  return finish(
    {
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
    },
    [],
    row,
    {
      metadata: validDueDays
        ? { boletoDueDays: dueDays, requiresBuyerAddress: true }
        : null,
      issues: validDueDays ? [] : ['INVALID_BOLETO_DUE_DAYS'],
      details: validDueDays
        ? []
        : [
            `INVALID_BOLETO_DUE_DAYS: vencimentoDias=${dueDays} is not an integer in 0-90`,
          ],
    },
  );
}
