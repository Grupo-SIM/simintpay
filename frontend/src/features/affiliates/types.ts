export type AffiliateProduct = 'plataformas' | 'ofertas';

/** Percentuais trafegam em basis points (2550 = 25,50%); null usa o global. */
export type Affiliate = {
  email: string;
  name?: string;
  code?: string;
  percentageBps: number | null;
};

export type InheritedAffiliate = {
  name: string;
  code: string;
  percentageBps: number;
};

export type AffiliateAgreement = {
  version: number;
  defaultPercentageBps: number | null;
  /** Plataforma: boolean. Oferta: null = usar a da plataforma. */
  commissionOnRenewals: boolean | null;
  linkBaseUrl?: string | null;
  affiliates: Affiliate[];
  inherited?: {
    defaultPercentageBps: number | null;
    commissionOnRenewals: boolean;
    affiliates: InheritedAffiliate[];
  };
};

export type AffiliateDraftRow = {
  id: string;
  email: string;
  name?: string;
  code?: string;
  /** Texto mascarado; vazio usa o percentual global. */
  percentage: string;
};

export type AffiliateDraft = {
  rows: AffiliateDraftRow[];
  defaultPercentage: string;
  /** 'platform' só existe na oferta (null no fio). */
  renewals: 'all' | 'first' | 'platform';
  linkBaseUrl: string;
};

export type AffiliateSaveInput = {
  defaultPercentageBps: number | null;
  commissionOnRenewals: boolean | null;
  linkBaseUrl?: string | null;
  affiliates: { email: string; percentageBps: number | null }[];
};

export type AffiliateReceipts = {
  data: {
    transactionId: string;
    amountCents: number;
    state: 'AVAILABLE' | 'LOCKED' | 'REVERSED';
    createdAt: string;
    originName: string | null;
    isRenewal?: boolean;
  }[];
  summary: {
    creditedCents: number;
    lockedCents: number;
    reversedCents: number;
  };
  /** Vínculos do afiliado (código e link prontos), quando o backend os envia. */
  affiliations?: {
    code: string;
    platformName?: string | null;
    linkBaseUrl?: string | null;
  }[];
  total: number;
  page: number;
  pageSize: number;
};
