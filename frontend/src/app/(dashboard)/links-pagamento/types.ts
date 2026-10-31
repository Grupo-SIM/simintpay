export type PaymentLinkFile = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  createdAt: string;
};

export type PaymentMethodFilter = 'all' | 'pix' | 'card' | 'all-methods';

export type LinkPagamentoStatus = 'Ativo' | 'Inativo';

export type LinkPagamentoRow = {
  id: string;
  titulo: string;
  produto: string;
  valor: number;
  criadoPor: string;
  criadoPorEmail?: string | null;
  metodoPagamento: PaymentMethodFilter;
  status: LinkPagamentoStatus;
  link: string;
  cpfDono: string | null;
  plataformas: string[];
};

export type LinkPagamentoFilters = {
  titulo: string;
  platform: string;
};

export type PaymentLinkOfferType = 'ORDER_BUMP' | 'UPSELL' | 'DOWNSELL';

/** Oferta como retornada pela API (order bump / upsell / downsell). */
export type PaymentLinkOffer = {
  id: string;
  tipo: PaymentLinkOfferType;
  chamada: string | null;
  titulo: string;
  descricao: string | null;
  imagemUrl: string | null;
  valor: number;
  valorOriginal: number | null;
  posicao: number;
  ativo: boolean;
  /** Material de entrega (só no painel; o checkout público não recebe) */
  mensagemEmail?: string | null;
  arquivos?: PaymentLinkFile[];
};
