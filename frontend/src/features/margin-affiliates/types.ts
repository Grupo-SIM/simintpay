import type { AffiliateAgreement } from '@/features/affiliates/types';
import type { Coproducer } from '@/features/coproduction/types';

export type InheritedMarginCoproducer = { name: string; percentageBps: number };

/** Acordo da margem SimIntPay: afiliados e coprodutores, sem link base. */
export type MarginAgreement = Omit<
  AffiliateAgreement,
  'inherited' | 'linkBaseUrl'
> & {
  coproducers: Coproducer[];
  inherited?: NonNullable<AffiliateAgreement['inherited']> & {
    coproducers: InheritedMarginCoproducer[];
  };
};

export type MarginSaveInput = {
  defaultPercentageBps: number | null;
  commissionOnRenewals: boolean | null;
  affiliates: { email: string; percentageBps: number | null }[];
  coproducers: { email: string; percentageBps: number }[];
};
