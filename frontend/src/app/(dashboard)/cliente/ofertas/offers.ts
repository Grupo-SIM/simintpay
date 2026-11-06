export const OFFERS_QUERY_KEY = 'cliente-ofertas';

export type OfferKind =
  'PAYMENT_LINK' | 'SUBSCRIPTION_LINK' | 'PLAN' | 'PIX_PLAN' | 'BOLETO';
export type OfferMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';
export type OfferRenewal = 'NONE' | 'AUTO_CHARGE' | 'MANUAL_PAY';
export type OfferInterval = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export type Offer = {
  id: string;
  code: string;
  kind: OfferKind;
  name: string;
  description: string | null;
  amountCents: number;
  isActive: boolean;
  platformTag: string | null;
  acceptedMethods: OfferMethod[];
  maxInstallments: number;
  renewalMode: OfferRenewal;
  intervalType: OfferInterval | null;
  intervalCount: number | null;
  repetitions: number | null;
  trialDays: number | null;
  retryDays: number | null;
  graceDays: number | null;
  accessDays: number | null;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  currency?: string;
  ownerUserId?: string;
  fulfillment?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

/** Valor mínimo de uma oferta (espelho de MIN_OFFER_AMOUNT_CENTS no backend). */
export const OFFER_MIN_AMOUNT_CENTS = 1499;
export const OFFER_MIN_AMOUNT_ERROR = 'O valor mínimo é R$ 14,99';

export const OFFER_KINDS: OfferKind[] = [
  'PAYMENT_LINK',
  'SUBSCRIPTION_LINK',
  'PLAN',
  'PIX_PLAN',
  'BOLETO',
];
/** Modelos oferecidos na criação; PLAN e PIX_PLAN seguem existindo em ofertas antigas. */
export const OFFER_PRESET_KINDS: OfferKind[] = [
  'PAYMENT_LINK',
  'SUBSCRIPTION_LINK',
  'BOLETO',
];
export const OFFER_METHODS: OfferMethod[] = [
  'PIX',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'BOLETO',
];

/** Rótulos dos enums do backend; o valor bruto nunca é exibido sem passar por aqui. */
export const kindLabels: Record<OfferKind, string> = {
  PAYMENT_LINK: 'Link de pagamento',
  SUBSCRIPTION_LINK: 'Assinatura',
  PLAN: 'Plano',
  PIX_PLAN: 'Plano PIX',
  BOLETO: 'Boleto',
};
export const kindDescriptions: Record<OfferKind, string> = {
  PAYMENT_LINK: 'Cobrança única com PIX, crédito ou débito.',
  SUBSCRIPTION_LINK: 'Assinatura recorrente cobrada automaticamente no cartão.',
  PLAN: 'Plano recorrente cobrado automaticamente no cartão.',
  PIX_PLAN: 'Acesso por período, renovado com um novo PIX a cada ciclo.',
  BOLETO: 'Cobrança única por boleto.',
};
export const methodLabels: Record<OfferMethod, string> = {
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  BOLETO: 'Boleto',
};
export const renewalLabels: Record<OfferRenewal, string> = {
  NONE: 'Compra única',
  AUTO_CHARGE: 'Automática no cartão',
  MANUAL_PAY: 'PIX a cada ciclo',
};
export const intervalLabels: Record<OfferInterval, string> = {
  DAY: 'Dia(s)',
  WEEK: 'Semana(s)',
  MONTH: 'Mês(es)',
  YEAR: 'Ano(s)',
};

/** Rótulo de um enum com o valor bruto como fallback (equivalente ao defaultValue do t()). */
export function enumLabel<T extends string>(
  labels: Record<T, string>,
  value: string | null | undefined,
): string {
  if (!value) return '—';
  return (labels as Record<string, string>)[value] ?? value;
}

export type OfferPreset = {
  acceptedMethods: OfferMethod[];
  maxInstallments: number;
  renewalMode: OfferRenewal;
  intervalType: OfferInterval | null;
  intervalCount: number | null;
  accessDays: number | null;
};

/** Espelho de backend/src/modules/offer/offer.presets.ts. */
export const OFFER_PRESETS: Record<OfferKind, OfferPreset> = {
  PAYMENT_LINK: {
    acceptedMethods: ['CREDIT_CARD', 'DEBIT_CARD', 'PIX'],
    maxInstallments: 12,
    renewalMode: 'NONE',
    intervalType: null,
    intervalCount: null,
    accessDays: null,
  },
  SUBSCRIPTION_LINK: {
    acceptedMethods: ['CREDIT_CARD', 'DEBIT_CARD'],
    maxInstallments: 1,
    renewalMode: 'AUTO_CHARGE',
    intervalType: 'MONTH',
    intervalCount: 1,
    accessDays: null,
  },
  PLAN: {
    acceptedMethods: ['CREDIT_CARD'],
    maxInstallments: 1,
    renewalMode: 'AUTO_CHARGE',
    intervalType: 'MONTH',
    intervalCount: 1,
    accessDays: null,
  },
  PIX_PLAN: {
    acceptedMethods: ['PIX'],
    maxInstallments: 1,
    renewalMode: 'MANUAL_PAY',
    intervalType: 'MONTH',
    intervalCount: 1,
    accessDays: 30,
  },
  BOLETO: {
    acceptedMethods: ['BOLETO'],
    maxInstallments: 1,
    renewalMode: 'NONE',
    intervalType: null,
    intervalCount: null,
    accessDays: null,
  },
};

export type OfferStatus = 'ACTIVE' | 'INACTIVE' | 'EXHAUSTED' | 'EXPIRED';
export const OFFER_STATUSES: OfferStatus[] = [
  'ACTIVE',
  'INACTIVE',
  'EXHAUSTED',
  'EXPIRED',
];
export const statusLabels: Record<OfferStatus, string> = {
  ACTIVE: 'Ativa',
  INACTIVE: 'Inativa',
  EXHAUSTED: 'Esgotada',
  EXPIRED: 'Expirada',
};

/** Mesma precedência do filtro do backend: desativada > vencida > esgotada > ativa. */
export function offerStatus(
  offer: Pick<Offer, 'isActive' | 'expiresAt' | 'maxUses' | 'usedCount'>,
  now = new Date(),
): OfferStatus {
  if (!offer.isActive) return 'INACTIVE';
  if (offer.expiresAt && new Date(offer.expiresAt) <= now) return 'EXPIRED';
  if (offer.maxUses != null && offer.usedCount >= offer.maxUses)
    return 'EXHAUSTED';
  return 'ACTIVE';
}

/** "usos / limite" da listagem (limite vazio = ilimitado). */
export function usesLabel(offer: Pick<Offer, 'usedCount' | 'maxUses'>): string {
  return `${offer.usedCount} / ${offer.maxUses ?? '∞'}`;
}

export function recurrenceSummary(offer: Offer): string {
  if (offer.renewalMode === 'NONE') return enumLabel(renewalLabels, 'NONE');
  const every = `A cada ${offer.intervalCount ?? 1} ${enumLabel(intervalLabels, offer.intervalType).toLowerCase()}`;
  return `${every} · ${enumLabel(renewalLabels, offer.renewalMode)}`;
}
