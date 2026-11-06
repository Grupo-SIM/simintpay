export type CoproductionProduct =
  | 'links-pagamento'
  | 'links-assinatura'
  | 'boletos'
  | 'planos'
  | 'planos-pix'
  | 'plataformas'
  | 'ofertas';

export type Coproducer = {
  email: string;
  name?: string;
  percentageBps: number;
};
export type Coproduction = {
  mode?: 'OWN' | 'INHERIT';
  effective?: {
    source: { platformId: string; version: number } | null;
    participants: Coproducer[];
  } | null;
  version: number;
  basis: 'NET';
  participants: Coproducer[];
};
export type CoproducerDraft = {
  id: string;
  email: string;
  name?: string;
  percentage: string;
};

export type CoproductionReceipts = {
  data: {
    transactionId: string;
    amountCents: number;
    state: 'AVAILABLE' | 'LOCKED' | 'REVERSED';
    createdAt: string;
    product: CoproductionProduct;
  }[];
  summary: {
    creditedCents: number;
    lockedCents: number;
    reversedCents: number;
  };
  total: number;
  page: number;
  pageSize: number;
};
