import {
  OFFER_MIN_AMOUNT_CENTS,
  OFFER_MIN_AMOUNT_ERROR,
  OFFER_TEMPLATES,
  type Offer,
  type OfferInterval,
  type OfferMethod,
  type OfferRenewal,
  type OfferTemplateId,
} from './offers';

export type BumpRole = 'BUMP' | 'UPSELL' | 'DOWNSELL';
export type FormBump = { offerId: string; role: BumpRole };

export const BUMP_ROLES: BumpRole[] = ['BUMP', 'UPSELL', 'DOWNSELL'];
export const bumpRoleLabels: Record<BumpRole, string> = {
  BUMP: 'Order bump',
  UPSELL: 'Upsell',
  DOWNSELL: 'Downsell',
};
export const MAX_BOLETO_DUE_DAYS = 90;
export const BOLETO_NOTE =
  'O comprador precisará informar o endereço completo.';

/** Estado do formulário; números e data ficam em texto até o envio. */
export type OfferForm = {
  name: string;
  description: string;
  amount: string;
  methods: OfferMethod[];
  maxInstallments: string;
  renewalMode: OfferRenewal;
  intervalType: OfferInterval;
  intervalCount: string;
  repetitions: string;
  trialDays: string;
  retryDays: string;
  graceDays: string;
  accessDays: string;
  expiresAt: string;
  maxUses: string;
  redirectUrl: string;
  emailBody: string;
  bumps: FormBump[];
  boletoDueDays: string;
  /** Partes do fulfillment/metadata que a tela não edita e que a edição deve preservar. */
  keep: {
    files: unknown[];
    communityId: string | null;
    metadata: Record<string, unknown>;
  };
};

const emptyKeep = (): OfferForm['keep'] => ({
  files: [],
  communityId: null,
  metadata: {},
});

export function formFromPreset(template: OfferTemplateId): OfferForm {
  const preset = OFFER_TEMPLATES[template];
  return {
    name: '',
    description: '',
    amount: '0,00',
    methods: [...preset.acceptedMethods],
    maxInstallments: String(preset.maxInstallments),
    renewalMode: preset.renewalMode,
    intervalType: preset.intervalType ?? 'MONTH',
    intervalCount: String(preset.intervalCount ?? 1),
    repetitions: '',
    trialDays: '',
    retryDays: '',
    graceDays: '',
    accessDays: preset.accessDays == null ? '' : String(preset.accessDays),
    expiresAt: '',
    maxUses: '',
    redirectUrl: '',
    emailBody: '',
    bumps: [],
    boletoDueDays: '',
    keep: emptyKeep(),
  };
}

/** Modelo rápido: troca só o que o preset define e mantém nome, valor, entrega e limites. */
export function applyPreset(
  form: OfferForm,
  template: OfferTemplateId,
): OfferForm {
  const preset = formFromPreset(template);
  return {
    ...form,
    methods: preset.methods,
    maxInstallments: preset.maxInstallments,
    renewalMode: preset.renewalMode,
    intervalType: preset.intervalType,
    intervalCount: preset.intervalCount,
    accessDays: preset.accessDays,
  };
}

/** AAAA-MM-DD no fuso local (o input de data é local; `slice` do ISO erraria o dia). */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const num = (value: number | null | undefined) =>
  value == null ? '' : String(value);

export function formFromOffer(
  offer: Offer,
  formatAmount: (value: number) => string,
): OfferForm {
  const fulfillment = (offer.fulfillment ?? {}) as Record<string, unknown>;
  const { boletoDueDays, ...metadata } = (offer.metadata ?? {}) as Record<
    string,
    unknown
  >;
  const bumps = Array.isArray(fulfillment.bumps)
    ? (fulfillment.bumps as FormBump[]).filter(
        (bump) =>
          typeof bump?.offerId === 'string' && BUMP_ROLES.includes(bump.role),
      )
    : [];
  return {
    name: offer.name,
    description: offer.description ?? '',
    amount: formatAmount(offer.amountCents / 100),
    methods: [...offer.acceptedMethods],
    maxInstallments: String(offer.maxInstallments),
    renewalMode: offer.renewalMode,
    intervalType: offer.intervalType ?? 'MONTH',
    intervalCount: String(offer.intervalCount ?? 1),
    repetitions: offer.repetitions ? String(offer.repetitions) : '',
    trialDays: num(offer.trialDays),
    retryDays: num(offer.retryDays),
    graceDays: num(offer.graceDays),
    accessDays: num(offer.accessDays),
    expiresAt: toDateInput(offer.expiresAt),
    maxUses: num(offer.maxUses),
    redirectUrl: text(fulfillment.redirectUrl),
    emailBody: text(fulfillment.emailBody),
    bumps,
    boletoDueDays:
      typeof boletoDueDays === 'number' ? String(boletoDueDays) : '',
    keep: {
      files: Array.isArray(fulfillment.files) ? fulfillment.files : [],
      communityId:
        typeof fulfillment.communityId === 'string'
          ? fulfillment.communityId
          : null,
      metadata,
    },
  };
}

export const digitsOnly = (value: string) => value.replace(/\D/g, '');
const toInt = (value: string): number | undefined =>
  value.trim() === '' ? undefined : Number(value);
const isInt = (value: number | undefined, min: number): value is number =>
  value !== undefined && Number.isInteger(value) && value >= min;

export const isRecurring = (form: Pick<OfferForm, 'renewalMode'>) =>
  form.renewalMode !== 'NONE';
/**
 * Modo de renovação gravado: com cartão aceito a renovação é automática (quem paga por PIX
 * cai no pagamento manual no backend); sem cartão, o comprador paga a cada ciclo.
 */
export function renewalModeOf(
  form: Pick<OfferForm, 'renewalMode' | 'methods'>,
): OfferRenewal {
  if (form.renewalMode === 'NONE') return 'NONE';
  return form.methods.some((m) => m === 'CREDIT_CARD' || m === 'DEBIT_CARD')
    ? 'AUTO_CHARGE'
    : 'MANUAL_PAY';
}
export const hasBoleto = (form: Pick<OfferForm, 'methods'>) =>
  form.methods.includes('BOLETO');

/** Espelho de unsafeUrlReason (offer-fulfillment.ts): http(s), sem credenciais nem host interno. */
export function unsafeUrlReason(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'URL inválida';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return 'Use uma URL http(s)';
  if (url.username || url.password) return 'A URL não pode conter credenciais';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const bare = host.replace(/^\[|\]$/g, '');
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(bare);
  const ipv6 = bare.includes(':');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localdomain') ||
    (!host.includes('.') && !ipv6)
  )
    return 'Host não permitido';
  if (ipv4) {
    const [a, b] = bare.split('.').map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
      return 'Endereço de rede interna não permitido';
  }
  if (
    ipv6 &&
    (bare === '::' ||
      bare === '::1' ||
      bare.startsWith('::ffff:') ||
      bare.startsWith('fc') ||
      bare.startsWith('fd') ||
      /^fe[89ab]/.test(bare))
  )
    return 'Endereço de rede interna não permitido';
  return null;
}

/** Problemas dos bumps segundo o contrato de offer-fulfillment.ts; null quando válidos. */
export function bumpsProblem(bumps: FormBump[]): string | null {
  const count = (role: BumpRole) =>
    bumps.filter((bump) => bump.role === role).length;
  if (new Set(bumps.map((b) => b.offerId)).size !== bumps.length)
    return 'Oferta repetida em bumps.';
  if (count('DOWNSELL') > 0 && count('UPSELL') === 0)
    return 'O downsell exige um upsell configurado.';
  return null;
}

/** Adiciona respeitando as regras do funil; devolve a mensagem quando a regra não permite. */
export function addBump(
  bumps: FormBump[],
  offerId: string,
  role: BumpRole,
): { bumps: FormBump[] } | { error: string } {
  const next = [...bumps, { offerId, role }];
  const problem = bumpsProblem(next);
  return problem ? { error: problem } : { bumps: next };
}

export const removeBump = (bumps: FormBump[], offerId: string): FormBump[] =>
  bumps.filter((bump) => bump.offerId !== offerId);

/** Ofertas avulsas, ativas, de outro registro e ainda não escolhidas. */
export function bumpCandidates(
  offers: Offer[],
  selfId: string | null,
  bumps: FormBump[],
): Offer[] {
  const taken = new Set(bumps.map((bump) => bump.offerId));
  return offers.filter(
    (offer) =>
      offer.isActive &&
      offer.renewalMode === 'NONE' &&
      offer.id !== selfId &&
      !taken.has(offer.id),
  );
}

/** Primeira mensagem de erro do formulário, ou null. Espelha offer.validator.ts e offer-fulfillment.ts. */
export function validateOfferForm(
  form: OfferForm,
  amount: number,
): string | null {
  if (!form.name.trim()) return 'Informe o nome da oferta.';
  if (form.name.trim().length > 120)
    return 'O nome deve ter no máximo 120 caracteres.';
  if (form.description.trim().length > 1000)
    return 'A descrição deve ter no máximo 1000 caracteres.';
  if (Math.round(amount * 100) < OFFER_MIN_AMOUNT_CENTS)
    return OFFER_MIN_AMOUNT_ERROR;
  if (form.methods.length === 0)
    return 'Selecione ao menos uma forma de pagamento.';
  const installments = toInt(form.maxInstallments) ?? 1;
  if (!Number.isInteger(installments) || installments < 1 || installments > 12)
    return 'O parcelamento deve ficar entre 1x e 12x.';
  if (isRecurring(form)) {
    if (!isInt(toInt(form.intervalCount), 1))
      return 'Informe o intervalo da recorrência.';
    const repetitions = toInt(form.repetitions);
    if (repetitions !== undefined && !isInt(repetitions, 0))
      return 'O número de cobranças deve ser zero ou mais.';
    for (const [label, value] of [
      ['Dias de teste', form.trialDays],
      ['Dias de retentativa', form.retryDays],
      ['Dias de carência', form.graceDays],
    ] as const) {
      const parsed = toInt(value);
      if (parsed !== undefined && !isInt(parsed, 0))
        return `${label} deve ser zero ou mais.`;
    }
  }
  const accessDays = toInt(form.accessDays);
  if (accessDays !== undefined && !isInt(accessDays, 1))
    return 'Dias de acesso deve ser no mínimo 1.';
  const maxUses = toInt(form.maxUses);
  if (maxUses !== undefined && !isInt(maxUses, 1))
    return 'O limite de usos deve ser no mínimo 1.';
  if (form.expiresAt && Number.isNaN(Date.parse(form.expiresAt)))
    return 'Data de validade inválida.';
  for (const [label, value] of [
    ['URL de redirecionamento', form.redirectUrl],
  ] as const) {
    const url = value.trim();
    if (!url) continue;
    if (url.length > 2048) return `${label} muito longa.`;
    const reason = unsafeUrlReason(url);
    if (reason) return `${label}: ${reason}.`;
  }
  if (form.emailBody.length > 20_000)
    return 'A mensagem do e-mail deve ter no máximo 20.000 caracteres.';
  const bumps = bumpsProblem(form.bumps);
  if (bumps) return bumps;
  if (hasBoleto(form)) {
    const due = toInt(form.boletoDueDays);
    if (due !== undefined && (!isInt(due, 0) || due > MAX_BOLETO_DUE_DAYS))
      return `O vencimento do boleto deve ficar entre 0 e ${MAX_BOLETO_DUE_DAYS} dias.`;
  }
  return null;
}

function metadataOf(form: OfferForm): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = { ...form.keep.metadata };
  delete metadata.boletoDueDays;
  if (hasBoleto(form)) {
    metadata.requiresBuyerAddress = true;
    const due = toInt(form.boletoDueDays);
    if (due !== undefined) metadata.boletoDueDays = due;
  } else {
    delete metadata.requiresBuyerAddress;
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function fulfillmentOf(form: OfferForm, create: boolean) {
  const base = {
    emailBody: form.emailBody.trim(),
    redirectUrl: form.redirectUrl.trim(),
    bumps: form.bumps,
  };
  const empty = !base.emailBody && !base.redirectUrl && base.bumps.length === 0;
  if (create && empty) return undefined;
  return {
    ...base,
    files: form.keep.files,
    ...(form.keep.communityId ? { communityId: form.keep.communityId } : {}),
  };
}

/**
 * Corpo de POST/PATCH /ofertas. A plataforma só vai na criação. Na edição, campos
 * vazios vão como `null` para limpar o valor salvo (omitido manteria o anterior).
 */
export function offerPayload(
  form: OfferForm,
  amount: number,
  create?: { platformTag?: string },
) {
  const edit = !create;
  const recurring = isRecurring(form);
  const installments = form.methods.includes('CREDIT_CARD')
    ? (toInt(form.maxInstallments) ?? 1)
    : 1;
  const optional = (value: string, send = true) => {
    const parsed = toInt(value);
    if (parsed !== undefined && send) return parsed;
    return edit ? null : undefined;
  };
  const metadata = metadataOf(form);
  const fulfillment = fulfillmentOf(form, !edit);
  const payload: Record<string, unknown> = {
    ...(create ? { platformTag: create.platformTag } : {}),
    name: form.name.trim(),
    description: form.description.trim(),
    amountCents: Math.round(amount * 100),
    acceptedMethods: form.methods,
    maxInstallments: installments,
    renewalMode: renewalModeOf(form),
    ...(recurring
      ? {
          intervalType: form.intervalType,
          intervalCount: toInt(form.intervalCount) ?? 1,
          // 0 = até cancelar; na edição é a única forma de limpar o limite salvo.
          ...(toInt(form.repetitions) !== undefined || edit
            ? { repetitions: toInt(form.repetitions) ?? 0 }
            : {}),
        }
      : {}),
    trialDays: optional(form.trialDays, recurring),
    retryDays: optional(form.retryDays, recurring),
    graceDays: optional(form.graceDays, recurring),
    accessDays: optional(form.accessDays),
    expiresAt: form.expiresAt
      ? new Date(`${form.expiresAt}T23:59:59`).toISOString()
      : edit
        ? null
        : undefined,
    maxUses: optional(form.maxUses),
    ...(fulfillment ? { fulfillment } : {}),
    // Na edição o metadata é substituído por inteiro; {} remove chaves de boleto antigas.
    ...(metadata || edit ? { metadata: metadata ?? {} } : {}),
  };
  // Descrição vazia só interessa para limpar na edição.
  if (!payload.description && !edit) delete payload.description;
  for (const key of Object.keys(payload))
    if (payload[key] === undefined) delete payload[key];
  return payload;
}
