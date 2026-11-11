import { BadRequestException } from '@nestjs/common';
import type { Offer } from '@prisma/client';
import type { CreatePaymentLinkDto } from '../../application/dtos/payment-link/create-payment-link.dto';
import type { UpdatePaymentLinkDto } from '../../application/dtos/payment-link/update-payment-link.dto';
import type { CreateSubscriptionLinkDto } from '../../application/dtos/subscription-link/create-subscription-link.dto';
import type { UpdateSubscriptionLinkDto } from '../../application/dtos/subscription-link/update-subscription-link.dto';
import {
  acceptedMethodList,
  normalizeStoredPaymentMethods,
  type StoredPaymentMethods,
} from '../../application/helpers/accepted-payment-methods.helper';
import { intervalForFrequency } from './legacy-offer-mapper';
import { readOfferFulfillment } from './offer-fulfillment';
import type { CreateOfferDto, UpdateOfferDto } from './offer.dto';

/**
 * REST adapters for the legacy `/links-pagamento` and `/links-assinatura` routes, backed by
 * `Offer` (plan 0023, section 9). Pure translation: request DTOs to offer DTOs and offers back to
 * the exact legacy response shapes. Every rule (ownership, minimum amount, platform, SSRF,
 * acquirer capabilities) stays in `OfferService`.
 */

/** Env flag that mounts the compat controllers INSTEAD of the legacy ones (default off). */
export const LEGACY_LINKS_COMPAT_ENV = 'OFFER_LEGACY_LINKS_COMPAT';

export function legacyLinksCompatEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[LEGACY_LINKS_COMPAT_ENV] === '1';
}

/** Controllers the legacy modules register: dropped when the compat adapters are on. */
export function legacyLinkControllers<T>(
  controllers: T[],
  env: Record<string, string | undefined> = process.env,
): T[] {
  return legacyLinksCompatEnabled(env) ? [] : controllers;
}

/** Controllers the offer module registers: only when the compat adapters are on. */
export function compatLinkControllers<T>(
  controllers: T[],
  env: Record<string, string | undefined> = process.env,
): T[] {
  return legacyLinksCompatEnabled(env) ? controllers : [];
}

type Method = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';
type Interval = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

const toCents = (reais: number) => Math.round(reais * 100);
const present = (value: string | undefined | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** One platform per operation, like `assertExplicitPlatform`; empty list means no platform. */
export function singlePlatformTag(
  tags: (string | undefined | null)[],
): string | undefined {
  const given = tags.map((t) => t?.trim()).filter((t): t is string => !!t);
  const distinct = new Set(
    given.map((t) => t.toUpperCase().replaceAll('_', '-')),
  );
  if (distinct.size > 1)
    throw new BadRequestException(
      'Selecione uma única plataforma por operação',
    );
  return given[0];
}

type FulfillmentBase = Record<string, unknown>;

/** Merges redirectUrl/emailBody over the current delivery (files and bumps are kept). */
function mergedFulfillment(
  current: unknown,
  dto: { redirectUrl?: string; emailBody?: string },
): FulfillmentBase | undefined {
  if (dto.redirectUrl === undefined && dto.emailBody === undefined)
    return undefined;
  const base = readOfferFulfillment(current);
  return {
    ...base,
    ...(dto.redirectUrl !== undefined
      ? { redirectUrl: present(dto.redirectUrl) ?? null }
      : {}),
    ...(dto.emailBody !== undefined
      ? { emailBody: present(dto.emailBody) ?? null }
      : {}),
  };
}

// ── Payment links ───────────────────────────────────────────────────────────

export function paymentMethodsOf(flags: {
  aceitaCartao?: boolean;
  aceitaDebito?: boolean;
  aceitaPix?: boolean;
}): Method[] {
  const methods: Method[] = [];
  if (flags.aceitaCartao ?? true) methods.push('CREDIT_CARD');
  if (flags.aceitaDebito ?? true) methods.push('DEBIT_CARD');
  if (flags.aceitaPix ?? true) methods.push('PIX');
  return methods;
}

export function paymentLinkToCreateOffer(
  dto: CreatePaymentLinkDto,
  ownerUserId?: string,
): CreateOfferDto {
  const aceitaCartao = dto.aceitaCartao ?? true;
  const fulfillment: FulfillmentBase = {};
  if (present(dto.redirectUrl))
    fulfillment.redirectUrl = present(dto.redirectUrl);
  if (present(dto.emailBody)) fulfillment.emailBody = present(dto.emailBody);
  return {
    kind: 'PAYMENT_LINK',
    name: dto.titulo,
    description: dto.descricao,
    amountCents: toCents(dto.valor),
    acceptedMethods: paymentMethodsOf(dto),
    maxInstallments: aceitaCartao ? (dto.parcelasMax ?? 1) : 1,
    renewalMode: 'NONE',
    expiresAt: dto.dataExpiracao,
    maxUses: dto.maxUses,
    fulfillment: Object.keys(fulfillment).length ? fulfillment : undefined,
    ownerUserId,
    platformTag: singlePlatformTag(dto.plataformas ?? []),
  } as CreateOfferDto;
}

export function paymentLinkToUpdateOffer(
  dto: UpdatePaymentLinkDto,
  existing: Offer,
): UpdateOfferDto {
  const flagged =
    dto.aceitaCartao !== undefined ||
    dto.aceitaDebito !== undefined ||
    dto.aceitaPix !== undefined;
  let acceptedMethods: Method[] | undefined;
  if (flagged) {
    const had = existing.acceptedMethods as Method[];
    acceptedMethods = paymentMethodsOf({
      aceitaCartao: dto.aceitaCartao ?? had.includes('CREDIT_CARD'),
      aceitaDebito: dto.aceitaDebito ?? had.includes('DEBIT_CARD'),
      aceitaPix: dto.aceitaPix ?? had.includes('PIX'),
    });
  }
  const noCard = acceptedMethods && !acceptedMethods.includes('CREDIT_CARD');
  return {
    name: dto.titulo,
    description: dto.descricao,
    amountCents: dto.valor === undefined ? undefined : toCents(dto.valor),
    acceptedMethods,
    // Card off: installments fall back to 1x unless the caller says otherwise.
    maxInstallments:
      dto.parcelasMax ??
      (noCard && existing.maxInstallments > 1 ? 1 : undefined),
    isActive: dto.isActive,
    expiresAt: dto.dataExpiracao,
    maxUses: dto.maxUses,
    fulfillment: mergedFulfillment(existing.fulfillment, dto),
    // Read by OfferService.update through assertOwnershipPreserved (platform is immutable).
    ...(dto.plataformas !== undefined
      ? { platformTag: singlePlatformTag(dto.plataformas) ?? '' }
      : {}),
  } as UpdateOfferDto;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

type OwnerView = {
  cpf?: string | null;
  name?: string | null;
  email?: string | null;
  clientStatus?: string | null;
} | null;

function formatCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const digits = cpf.replace(/\D/g, '');
  return digits.length === 11
    ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : cpf;
}

const plataformasOf = (offer: Offer) =>
  offer.platformTag ? [offer.platformTag] : [];

export function paymentLinkCreated(offer: Offer) {
  return {
    id: offer.id,
    codigo: offer.code,
    titulo: offer.name,
    descricao: offer.description ?? null,
    valor: offer.amountCents / 100,
    dataExpiracao: iso(offer.expiresAt),
    parcelasMax: offer.maxInstallments,
    ativo: offer.isActive,
    isStandalone: true,
    criadoEm: offer.createdAt.toISOString(),
  };
}

export function paymentLinkDetail(offer: Offer) {
  const methods = offer.acceptedMethods as Method[];
  const fulfillment = readOfferFulfillment(offer.fulfillment);
  return {
    ...paymentLinkCreated(offer),
    aceitaCartao: methods.includes('CREDIT_CARD'),
    aceitaDebito: methods.includes('DEBIT_CARD'),
    aceitaPix: methods.includes('PIX'),
    redirectUrl: fulfillment.redirectUrl,
    webhookUrl: null,
    emailBody: fulfillment.emailBody,
    plataformas: plataformasOf(offer),
    files: fulfillment.files.map((file) => ({
      id: file.fileUrl,
      fileName: file.fileName,
      fileUrl: file.fileUrl,
      fileSize: null,
      createdAt: offer.createdAt,
    })),
    ofertas: [],
  };
}

export function paymentLinkListItem(
  offer: Offer,
  owner: OwnerView,
  coproducao: unknown,
) {
  return {
    id: offer.id,
    codigo: offer.code,
    titulo: offer.name,
    descricao: offer.description ?? null,
    valor: offer.amountCents / 100,
    dataExpiracao: iso(offer.expiresAt),
    parcelasMax: offer.maxInstallments,
    ativo: offer.isActive,
    criadoEm: offer.createdAt.toISOString(),
    cpfDono: formatCpf(owner?.cpf),
    donoNome: owner?.name ?? null,
    donoEmail: owner?.email ?? null,
    coproducao: coproducao ?? null,
    plataformas:
      owner?.clientStatus != null ? ['SIMINTPAY'] : plataformasOf(offer),
  };
}

// ── Subscription links ──────────────────────────────────────────────────────

/** `frequencia` label of an offer interval (what the legacy `mapFreq(PlanType)` returned). */
export function frequencyLabel(offer: {
  intervalType: Interval | null;
  intervalCount: number | null;
}): string {
  const count = offer.intervalCount ?? 1;
  if (offer.intervalType === 'WEEK' && count === 1) return 'SEMANAL';
  if (offer.intervalType === 'YEAR' && count === 1) return 'ANUAL';
  if (offer.intervalType === 'MONTH' && count === 3) return 'TRIMESTRAL';
  if (offer.intervalType === 'MONTH' && count === 6) return 'SEMESTRAL';
  return 'MENSAL';
}

/** Legacy `PlanType` enum value for a `frequencia` label. */
export function planTypeOf(label: string): string {
  return (
    {
      SEMANAL: 'WEEKLY',
      MENSAL: 'MONTHLY',
      TRIMESTRAL: 'TRIMESTRAL',
      SEMESTRAL: 'SEMESTRAL',
      ANUAL: 'ANUAL',
    }[label] ?? 'MONTHLY'
  );
}

function storedMethodsOf(offer: Offer): StoredPaymentMethods {
  const methods = offer.acceptedMethods as Method[];
  const card = methods.includes('CREDIT_CARD');
  const pix = methods.includes('PIX');
  return card && !pix ? 'CREDIT_CARD' : pix && !card ? 'PIX' : 'BOTH';
}

const scheduleFor = (freq: string | undefined | null) => {
  const interval = intervalForFrequency(freq);
  return {
    intervalType: interval.type,
    intervalCount: interval.count,
  };
};

/** PIX-only subscriptions cannot be auto-charged: they are paid by the buyer each cycle. */
const renewalFor = (methods: StoredPaymentMethods) =>
  methods === 'PIX' ? ('MANUAL_PAY' as const) : ('AUTO_CHARGE' as const);

export function subscriptionLinkToCreateOffer(
  dto: CreateSubscriptionLinkDto,
  ownerUserId?: string,
): CreateOfferDto {
  const stored = normalizeStoredPaymentMethods(dto.paymentMethods);
  const fulfillment: FulfillmentBase = {};
  if (present(dto.redirectUrl))
    fulfillment.redirectUrl = present(dto.redirectUrl);
  if (present(dto.emailBody)) fulfillment.emailBody = present(dto.emailBody);
  return {
    kind: 'SUBSCRIPTION_LINK',
    name: dto.nome,
    description: dto.descricao,
    amountCents: toCents(dto.valor),
    acceptedMethods: acceptedMethodList(stored),
    maxInstallments: 1,
    renewalMode: renewalFor(stored),
    ...scheduleFor(dto.frequencia),
    maxUses: dto.maxUses,
    fulfillment: Object.keys(fulfillment).length ? fulfillment : undefined,
    ownerUserId,
    platformTag: singlePlatformTag([
      ...(dto.plataformas ?? []),
      dto.platformTag,
    ]),
  } as CreateOfferDto;
}

export function subscriptionLinkToUpdateOffer(
  dto: UpdateSubscriptionLinkDto,
  existing: Offer,
): UpdateOfferDto {
  const stored =
    dto.paymentMethods !== undefined
      ? normalizeStoredPaymentMethods(dto.paymentMethods)
      : undefined;
  const platformProvided =
    dto.plataformas !== undefined || dto.platformTag !== undefined;
  return {
    name: dto.nome,
    description: dto.descricao,
    amountCents: dto.valor === undefined ? undefined : toCents(dto.valor),
    ...(dto.frequencia !== undefined ? scheduleFor(dto.frequencia) : {}),
    ...(stored
      ? {
          acceptedMethods: acceptedMethodList(stored),
          renewalMode: renewalFor(stored),
        }
      : {}),
    isActive: dto.isActive,
    maxUses: dto.maxUses,
    fulfillment: mergedFulfillment(existing.fulfillment, dto),
    ...(platformProvided
      ? {
          platformTag:
            singlePlatformTag([...(dto.plataformas ?? []), dto.platformTag]) ??
            '',
        }
      : {}),
  } as UpdateOfferDto;
}

export function subscriptionLinkCreated(offer: Offer) {
  return {
    id: offer.id,
    codigo: offer.code,
    nome: offer.name,
    descricao: offer.description ?? null,
    valor: offer.amountCents / 100,
    frequencia: frequencyLabel(offer),
    isStandalone: true,
    platformFee: 0,
    ativo: offer.isActive,
    criadoEm: offer.createdAt.toISOString(),
  };
}

export function subscriptionLinkUpdated(offer: Offer) {
  return {
    id: offer.id,
    codigo: offer.code,
    nome: offer.name,
    descricao: offer.description ?? null,
    valor: offer.amountCents / 100,
    isStandalone: true,
    platformFee: 0,
    ativo: offer.isActive,
  };
}

export function subscriptionLinkDetail(
  offer: Offer,
  ownerEmail: string | null,
) {
  const fulfillment = readOfferFulfillment(offer.fulfillment);
  const label = frequencyLabel(offer);
  return {
    id: offer.id,
    codigo: offer.code,
    nome: offer.name,
    descricao: offer.description ?? null,
    valor: offer.amountCents / 100,
    frequencia: label,
    frequencyType: planTypeOf(label),
    isStandalone: true,
    platformFee: 0,
    paymentMethods: storedMethodsOf(offer),
    ownerEmail,
    ativo: offer.isActive,
    usos: offer.usedCount,
    maxUsos: offer.maxUses ?? null,
    redirectUrl: fulfillment.redirectUrl,
    webhookUrl: null,
    platformTag: offer.platformTag ?? null,
    emailBody: fulfillment.emailBody,
    plataformas: plataformasOf(offer),
    criadoEm: offer.createdAt.toISOString(),
  };
}

export function subscriptionLinkListItem(
  offer: Offer,
  owner: OwnerView,
  coproducao: unknown,
) {
  const recorded = plataformasOf(offer);
  const isCliente = owner?.clientStatus != null && recorded.length === 0;
  return {
    id: offer.id,
    codigo: offer.code,
    nome: offer.name,
    descricao: offer.description ?? null,
    valor: offer.amountCents / 100,
    frequencia: frequencyLabel(offer),
    isStandalone: true,
    platformFee: 0,
    ativo: offer.isActive,
    usos: offer.usedCount,
    maxUsos: offer.maxUses ?? null,
    criadoEm: offer.createdAt.toISOString(),
    coproducao: coproducao ?? null,
    donoNome: owner?.name ?? null,
    donoEmail: owner?.email ?? null,
    plataformas: isCliente ? ['SIMINTPAY'] : recorded,
  };
}

export function subscriptionLinkPublic(
  offer: Offer,
  quote: { totalAmount: number } | null,
  pixQuote: { totalAmount: number } | null,
  platformTag: string,
) {
  const base = offer.amountCents / 100;
  const methods = storedMethodsOf(offer);
  return {
    id: offer.id,
    codigo: offer.code,
    nome: offer.name,
    descricao: offer.description ?? null,
    valor: base,
    valorComJuros: quote?.totalAmount ?? base,
    valorPix: pixQuote?.totalAmount ?? base,
    platformFee: 0,
    isStandalone: true,
    frequencia: frequencyLabel(offer),
    ativo: offer.isActive,
    redirectUrl: readOfferFulfillment(offer.fulfillment).redirectUrl,
    platformTag,
    paymentMethods: methods,
    aceitaCartao: methods !== 'PIX',
    aceitaPix: methods !== 'CREDIT_CARD',
  };
}
