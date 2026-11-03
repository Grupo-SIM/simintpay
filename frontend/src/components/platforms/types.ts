import type { PlatformOwnership } from '@/lib/product-platforms';

export type Platform = PlatformOwnership & {
  id: string;
  tag: string;
  name: string;
  isActive: boolean;
  coproducao?: {
    role: 'OWNER' | 'COPRODUCER';
    readOnly: boolean;
  };
  ownerUserId: string;
  customerInterestRates: Record<string, number> | null;
  effectiveCustomerInterestRates?: Record<string, number>;
  absorbCustomerInterest: boolean;
  /** Present for owners; the fixed fee already includes the acquirer cost. */
  withdrawalFees?: { fixed: number; percent: number; minimum: number };
};

export const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    value,
  );
export const panel =
  'rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-white/5';

export type PlatformIntegrationSettings = {
  INBOUND_TOKEN: string | null;
  INBOUND_OPERATIONS: string | null;
  WEBHOOK_SECRET: string | null;
  WEBHOOK_URL: string | null;
};
