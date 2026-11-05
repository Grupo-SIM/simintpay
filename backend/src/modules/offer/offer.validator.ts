import type {
  BillingIntervalType,
  PaymentMethod,
  RenewalMode,
} from '@prisma/client';
import type { Acquirer } from '../../core/services/acquirer.enum';
import { acquirerCapabilities } from '../../core/services/acquirer-capabilities';

/** Valor mínimo de uma oferta (R$ 14,99), conforme docs/business-rules.md. */
export const MIN_OFFER_AMOUNT_CENTS = 1499;

const INTERVALS: readonly BillingIntervalType[] = [
  'DAY',
  'WEEK',
  'MONTH',
  'YEAR',
];
const METHODS: readonly PaymentMethod[] = [
  'PIX',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'BOLETO',
];
const CARD_METHODS: readonly PaymentMethod[] = ['CREDIT_CARD', 'DEBIT_CARD'];

export type OfferInput = {
  amountCents: number;
  acceptedMethods: readonly PaymentMethod[];
  maxInstallments?: number | null;
  renewalMode?: RenewalMode | null;
  intervalType?: BillingIntervalType | null;
  intervalCount?: number | null;
  repetitions?: number | null;
  trialDays?: number | null;
  retryDays?: number | null;
  graceDays?: number | null;
  accessDays?: number | null;
  metadata?: Record<string, unknown> | null;
  /** Adquirente roteado para a plataforma da oferta. */
  acquirer: Acquirer;
};

export type NormalizedOffer = {
  amountCents: number;
  acceptedMethods: PaymentMethod[];
  maxInstallments: number;
  renewalMode: RenewalMode;
  intervalType: BillingIntervalType | null;
  intervalCount: number | null;
  repetitions: number | null;
  trialDays: number | null;
  retryDays: number | null;
  graceDays: number | null;
  accessDays: number | null;
  metadata: Record<string, unknown> | null;
};

export class OfferValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('; '));
    this.name = 'OfferValidationError';
  }
}

const isInt = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min;
const present = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

/** Valida e normaliza uma oferta. Pura: lança `OfferValidationError` com todos os problemas. */
export function validateOfferInput(input: OfferInput): NormalizedOffer {
  const issues: string[] = [];
  const caps = acquirerCapabilities(input.acquirer);
  const renewalMode = input.renewalMode ?? 'NONE';

  if (!isInt(input.amountCents, MIN_OFFER_AMOUNT_CENTS)) {
    issues.push('O valor mínimo é R$ 14,99');
  }

  const requested = Array.isArray(input.acceptedMethods)
    ? input.acceptedMethods
    : [];
  const methods = [...new Set(requested)];
  if (methods.length === 0) {
    issues.push('Informe ao menos um meio de pagamento');
  }
  const unknown = methods.filter((method) => !METHODS.includes(method));
  if (unknown.length) {
    issues.push(`Meios de pagamento inválidos: ${unknown.join(', ')}`);
  }
  const unsupported = methods.filter(
    (method) => METHODS.includes(method) && !caps.methods.has(method),
  );
  if (unsupported.length) {
    issues.push(
      `Meios não suportados pelo adquirente: ${unsupported.join(', ')}`,
    );
  }

  const maxInstallments = input.maxInstallments ?? 1;
  if (!isInt(maxInstallments, 1)) {
    issues.push('Parcelamento máximo deve ser um inteiro maior que zero');
  } else if (maxInstallments > 1) {
    if (!methods.includes('CREDIT_CARD')) {
      issues.push('Parcelamento só é permitido com cartão de crédito');
    }
    if (maxInstallments > caps.maxInstallments) {
      issues.push(
        `Parcelamento máximo do adquirente é ${caps.maxInstallments}x`,
      );
    }
  }

  let intervalType: BillingIntervalType | null = null;
  let intervalCount: number | null = null;
  let repetitions: number | null = null;
  if (renewalMode === 'NONE') {
    if (
      present(input.intervalType) ||
      present(input.intervalCount) ||
      present(input.repetitions)
    ) {
      issues.push('Oferta sem renovação não aceita intervalo ou repetições');
    }
  } else if (renewalMode === 'AUTO_CHARGE' || renewalMode === 'MANUAL_PAY') {
    if (
      !present(input.intervalType) ||
      !INTERVALS.includes(input.intervalType)
    ) {
      issues.push('Informe o tipo de intervalo da recorrência');
    } else {
      intervalType = input.intervalType;
    }
    if (!isInt(input.intervalCount, 1)) {
      issues.push(
        'Informe a quantidade de intervalos (inteiro maior que zero)',
      );
    } else {
      intervalCount = input.intervalCount;
    }
    if (present(input.repetitions)) {
      if (!isInt(input.repetitions, 0)) {
        issues.push('Repetições deve ser um inteiro maior ou igual a zero');
      } else {
        repetitions = input.repetitions;
      }
    }
    if (renewalMode === 'AUTO_CHARGE') {
      if (!caps.chargeStoredCard) {
        issues.push(
          'O adquirente não permite cobrança automática em cartão salvo',
        );
      }
      if (!methods.some((method) => CARD_METHODS.includes(method))) {
        issues.push('Cobrança automática exige cartão como meio aceito');
      }
    }
  } else {
    issues.push('Modo de renovação inválido');
  }

  if (present(input.accessDays) && !isInt(input.accessDays, 1)) {
    issues.push('Dias de acesso deve ser um inteiro maior ou igual a 1');
  }
  for (const [label, value] of [
    ['Dias de teste', input.trialDays],
    ['Dias de retentativa', input.retryDays],
    ['Dias de carência', input.graceDays],
  ] as const) {
    if (present(value) && !isInt(value, 0)) {
      issues.push(`${label} deve ser um inteiro maior ou igual a zero`);
    }
  }

  if (issues.length) throw new OfferValidationError(issues);

  // Boleto exige endereço completo do comprador; aqui só marcamos a flag.
  const metadata = methods.includes('BOLETO')
    ? { ...(input.metadata ?? {}), requiresBuyerAddress: true }
    : (input.metadata ?? null);

  return {
    amountCents: input.amountCents,
    acceptedMethods: methods,
    maxInstallments,
    renewalMode,
    intervalType,
    intervalCount,
    repetitions,
    trialDays: input.trialDays ?? null,
    retryDays: input.retryDays ?? null,
    graceDays: input.graceDays ?? null,
    accessDays: input.accessDays ?? null,
    metadata,
  };
}
