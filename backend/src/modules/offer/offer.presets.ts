import type {
  BillingIntervalType,
  OfferKind,
  PaymentMethod,
  RenewalMode,
} from '@prisma/client';

export type OfferPreset = {
  acceptedMethods: PaymentMethod[];
  maxInstallments: number;
  renewalMode: RenewalMode;
  intervalType: BillingIntervalType | null;
  intervalCount: number | null;
  accessDays: number | null;
};

/** Padrões que reproduzem os cinco produtos legados; o cliente pode sobrescrever campo a campo. */
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
