import { VALOR_MINIMO_ERRO, VALOR_MINIMO } from '../_shared';

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
  accessDays: number | null;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  createdAt: string;
};

export const OFFER_KINDS: OfferKind[] = [
  'PAYMENT_LINK',
  'SUBSCRIPTION_LINK',
  'PLAN',
  'PIX_PLAN',
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
  SUBSCRIPTION_LINK: 'Link de assinatura',
  PLAN: 'Plano',
  PIX_PLAN: 'Plano PIX',
  BOLETO: 'Boleto',
};
export const kindDescriptions: Record<OfferKind, string> = {
  PAYMENT_LINK: 'Cobrança única com PIX, crédito ou débito.',
  SUBSCRIPTION_LINK: 'Assinatura recorrente no cartão de crédito.',
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
  AUTO_CHARGE: 'Cobrança automática no cartão',
  MANUAL_PAY: 'Novo PIX a cada ciclo',
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
    maxInstallments: 1,
    renewalMode: 'NONE',
    intervalType: null,
    intervalCount: null,
    accessDays: null,
  },
  SUBSCRIPTION_LINK: {
    acceptedMethods: ['CREDIT_CARD'],
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

/** Estado do formulário; números e data ficam em texto até o envio. */
export type OfferForm = {
  kind: OfferKind;
  name: string;
  description: string;
  amount: string;
  methods: OfferMethod[];
  maxInstallments: string;
  renewalMode: OfferRenewal;
  intervalType: OfferInterval;
  intervalCount: string;
  repetitions: string;
  accessDays: string;
  expiresAt: string;
  maxUses: string;
};

export function formFromPreset(kind: OfferKind): OfferForm {
  const preset = OFFER_PRESETS[kind];
  return {
    kind,
    name: '',
    description: '',
    amount: '0,00',
    methods: [...preset.acceptedMethods],
    maxInstallments: String(preset.maxInstallments),
    renewalMode: preset.renewalMode,
    intervalType: preset.intervalType ?? 'MONTH',
    intervalCount: String(preset.intervalCount ?? 1),
    repetitions: '',
    accessDays: preset.accessDays == null ? '' : String(preset.accessDays),
    expiresAt: '',
    maxUses: '',
  };
}

export function formFromOffer(
  offer: Offer,
  formatAmount: (value: number) => string,
): OfferForm {
  return {
    kind: offer.kind,
    name: offer.name,
    description: offer.description ?? '',
    amount: formatAmount(offer.amountCents / 100),
    methods: [...offer.acceptedMethods],
    maxInstallments: String(offer.maxInstallments),
    renewalMode: offer.renewalMode,
    intervalType: offer.intervalType ?? 'MONTH',
    intervalCount: String(offer.intervalCount ?? 1),
    repetitions: offer.repetitions ? String(offer.repetitions) : '',
    accessDays: offer.accessDays == null ? '' : String(offer.accessDays),
    expiresAt: offer.expiresAt ? offer.expiresAt.slice(0, 10) : '',
    maxUses: offer.maxUses == null ? '' : String(offer.maxUses),
  };
}

export const digitsOnly = (value: string) => value.replace(/\D/g, '');
const toInt = (value: string): number | undefined =>
  value.trim() === '' ? undefined : Number(value);

/** Primeira mensagem de erro do formulário, ou null. */
export function validateOfferForm(
  form: OfferForm,
  amount: number,
): string | null {
  if (!form.name.trim()) return 'Informe o nome da oferta.';
  if (amount < VALOR_MINIMO) return VALOR_MINIMO_ERRO;
  if (form.methods.length === 0)
    return 'Selecione ao menos uma forma de pagamento.';
  const installments = toInt(form.maxInstallments) ?? 1;
  if (!Number.isInteger(installments) || installments < 1 || installments > 12)
    return 'O parcelamento deve ficar entre 1x e 12x.';
  if (installments > 1 && !form.methods.includes('CREDIT_CARD'))
    return 'Parcelamento exige cartão de crédito.';
  if (form.renewalMode !== 'NONE') {
    if ((toInt(form.intervalCount) ?? 0) < 1)
      return 'Informe o intervalo da recorrência.';
    if (
      form.renewalMode === 'AUTO_CHARGE' &&
      !form.methods.some((m) => m === 'CREDIT_CARD' || m === 'DEBIT_CARD')
    )
      return 'Cobrança automática exige cartão.';
  }
  const accessDays = toInt(form.accessDays);
  if (accessDays !== undefined && accessDays < 1)
    return 'Dias de acesso deve ser no mínimo 1.';
  const maxUses = toInt(form.maxUses);
  if (maxUses !== undefined && maxUses < 1)
    return 'O limite de usos deve ser no mínimo 1.';
  return null;
}

/** Corpo de POST/PATCH /ofertas. `kind` e plataforma só vão na criação. */
export function offerPayload(
  form: OfferForm,
  amount: number,
  create?: { platformTag: string },
) {
  const recurring = form.renewalMode !== 'NONE';
  const installments = form.methods.includes('CREDIT_CARD')
    ? (toInt(form.maxInstallments) ?? 1)
    : 1;
  return {
    ...(create ? { kind: form.kind, platformTag: create.platformTag } : {}),
    name: form.name.trim(),
    ...(form.description.trim()
      ? { description: form.description.trim() }
      : {}),
    amountCents: Math.round(amount * 100),
    acceptedMethods: form.methods,
    maxInstallments: installments,
    renewalMode: form.renewalMode,
    ...(recurring
      ? {
          intervalType: form.intervalType,
          intervalCount: toInt(form.intervalCount) ?? 1,
          ...(toInt(form.repetitions) !== undefined
            ? { repetitions: toInt(form.repetitions) }
            : {}),
        }
      : {}),
    ...(toInt(form.accessDays) !== undefined
      ? { accessDays: toInt(form.accessDays) }
      : {}),
    ...(form.expiresAt
      ? { expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString() }
      : {}),
    ...(toInt(form.maxUses) !== undefined
      ? { maxUses: toInt(form.maxUses) }
      : {}),
  };
}

export type OfferStatus = 'Ativo' | 'Inativo' | 'Limite atingido';
export function offerStatus(offer: Offer, now = new Date()): OfferStatus {
  if (!offer.isActive) return 'Inativo';
  if (offer.expiresAt && new Date(offer.expiresAt) <= now) return 'Inativo';
  if (offer.maxUses != null && offer.usedCount >= offer.maxUses)
    return 'Limite atingido';
  return 'Ativo';
}

export function recurrenceSummary(offer: Offer): string {
  if (offer.renewalMode === 'NONE') return enumLabel(renewalLabels, 'NONE');
  const every = `A cada ${offer.intervalCount ?? 1} ${enumLabel(intervalLabels, offer.intervalType).toLowerCase()}`;
  return `${every} · ${enumLabel(renewalLabels, offer.renewalMode)}`;
}
