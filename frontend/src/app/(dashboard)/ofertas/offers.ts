export const OFFERS_QUERY_KEY = 'cliente-ofertas';

export type OfferMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';
export type OfferRenewal = 'NONE' | 'AUTO_CHARGE' | 'MANUAL_PAY';
export type OfferInterval = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export type Offer = {
  id: string;
  code: string;
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
  owner?: { id: string; name: string; email: string };
  fulfillment?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

/** Valor mínimo de uma oferta (espelho de MIN_OFFER_AMOUNT_CENTS no backend). */
export const OFFER_MIN_AMOUNT_CENTS = 1499;
export const OFFER_MIN_AMOUNT_ERROR = 'O valor mínimo é R$ 14,99';

export const OFFER_METHODS: OfferMethod[] = [
  'PIX',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'BOLETO',
];

/** Rótulos dos enums do backend; o valor bruto nunca é exibido sem passar por aqui. */
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

/** Modelos rápidos do formulário: só preenchem campos no cliente e nunca são salvos na oferta. */
export type OfferTemplateId = 'ONE_TIME' | 'CARD_SUBSCRIPTION' | 'BOLETO';
export const OFFER_TEMPLATE_IDS: OfferTemplateId[] = [
  'ONE_TIME',
  'CARD_SUBSCRIPTION',
  'BOLETO',
];
export const templateLabels: Record<OfferTemplateId, string> = {
  ONE_TIME: 'Link de pagamento',
  CARD_SUBSCRIPTION: 'Assinatura',
  BOLETO: 'Boleto',
};
export const templateDescriptions: Record<OfferTemplateId, string> = {
  ONE_TIME: 'Cobrança única com PIX, crédito ou débito.',
  CARD_SUBSCRIPTION: 'Assinatura recorrente cobrada automaticamente no cartão.',
  BOLETO: 'Cobrança única por boleto.',
};
export const OFFER_TEMPLATES: Record<OfferTemplateId, OfferPreset> = {
  ONE_TIME: {
    acceptedMethods: ['CREDIT_CARD', 'DEBIT_CARD', 'PIX'],
    maxInstallments: 12,
    renewalMode: 'NONE',
    intervalType: null,
    intervalCount: null,
    accessDays: null,
  },
  CARD_SUBSCRIPTION: {
    acceptedMethods: ['CREDIT_CARD', 'DEBIT_CARD'],
    maxInstallments: 1,
    renewalMode: 'AUTO_CHARGE',
    intervalType: 'MONTH',
    intervalCount: 1,
    accessDays: null,
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

/** Descrição derivada dos atributos da oferta (não existe tipo armazenado). */
export function offerLabel(
  offer: Pick<Offer, 'renewalMode' | 'accessDays'>,
): string {
  if (offer.renewalMode === 'AUTO_CHARGE') return 'Assinatura no cartão';
  if (offer.renewalMode === 'MANUAL_PAY') return 'Assinatura por PIX';
  return offer.accessDays != null ? 'Acesso por tempo' : 'Compra única';
}

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
  return offer.maxUses == null
    ? String(offer.usedCount)
    : `${offer.usedCount} / ${offer.maxUses}`;
}

export function recurrenceSummary(offer: Offer): string {
  if (offer.renewalMode === 'NONE') return enumLabel(renewalLabels, 'NONE');
  const every = `A cada ${offer.intervalCount ?? 1} ${enumLabel(intervalLabels, offer.intervalType).toLowerCase()}`;
  return `${every} · ${enumLabel(renewalLabels, offer.renewalMode)}`;
}
