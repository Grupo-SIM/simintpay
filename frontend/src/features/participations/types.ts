import type {
  AffiliateAgreement,
  AffiliateSaveInput,
} from '@/features/affiliates/types';
import type { Coproducer, Coproduction } from '@/features/coproduction/types';
import type {
  MarginAgreement,
  MarginSaveInput,
} from '@/features/margin-affiliates/types';

/** Uma participação da pessoa: ligada ou não, com percentual em texto mascarado. */
export type ShareDraft = { on: boolean; percentage: string };

export type PersonDraft = {
  id: string;
  email: string;
  name?: string;
  /** Código de afiliado de produto, já gerado pelo servidor. */
  code?: string;
  coProduct: ShareDraft;
  /** Percentual vazio usa o padrão global. */
  affProduct: ShareDraft;
  /** Percentual vazio usa o padrão global da margem. */
  affMargin: ShareDraft;
  coMargin: ShareDraft;
};

export type ShareKey = 'coProduct' | 'affProduct' | 'affMargin' | 'coMargin';

/** 'platform' só existe na oferta (herda da plataforma). */
export type RenewalsChoice = 'all' | 'first' | 'platform';

export type SettingsDraft = {
  mode: 'OWN' | 'INHERIT';
  defaultPercentage: string;
  renewals: RenewalsChoice;
  linkBaseUrl: string;
  marginDefaultPercentage: string;
  marginRenewals: RenewalsChoice;
};

export type ParticipationsDraft = {
  people: PersonDraft[];
  settings: SettingsDraft;
};

export type Agreements = {
  co: Coproduction;
  aff: AffiliateAgreement;
  /** Só admin. */
  margin?: MarginAgreement;
};

export type ParticipationsContext = {
  platform: boolean;
  admin: boolean;
  /** Oferta com modo OWN/INHERIT de co-produção. */
  allowInheritance: boolean;
  /** Dono não admin: não pode ser coprodutor nem afiliado da própria venda. */
  ownerEmail?: string;
};

export type SavePlan = {
  co: { participants: Coproducer[]; mode?: 'OWN' | 'INHERIT' };
  aff: AffiliateSaveInput;
  margin?: MarginSaveInput;
};
