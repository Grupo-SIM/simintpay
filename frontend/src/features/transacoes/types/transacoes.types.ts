export type TransacaoStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'IN_MEDIATION'
  | 'CHARGEBACK'
  | 'PENDING_REFUND';

export type TransacaoPaymentMethod = 'PIX' | 'CREDIT_CARD' | 'BOLETO' | string;
export type TransacaoAcquirer = 'DOM' | 'FRENDZ' | string;

/** Participação do usuário via coprodução; coprodutores veem a transação somente leitura. */
export type TransacaoCoproducao = {
  role: 'OWNER' | 'COPRODUCER';
  readOnly: boolean;
  product: string | null;
  myAmountCents: number | null;
  state: 'AVAILABLE' | 'LOCKED' | 'REVERSED' | string | null;
};

export type Transacao = {
  coproducao?: TransacaoCoproducao | null;
  id: string;
  status: TransacaoStatus | string;
  /** Decimal do transporte. Não representa centavos. */
  amount: number | string;
  netAmount?: number | string | null;
  plataforma?: string;
  descricao?: string;
  totalFee?: number | string | null;
  valorBrutoVenda?: number;
  taxaDom?: number;
  taxaVendedor?: number;
  taxaFixaTransacao?: number;
  taxaCashback?: number;
  taxaServico?: number;
  valorLiquidoVendedor?: number;
  lucroMaster?: number;
  paymentMethod: TransacaoPaymentMethod;
  acquirer?: TransacaoAcquirer;
  installments?: number;
  customerName?: string | null;
  customerDocument?: string | null;
  customerEmail?: string | null;
  createdAt: string;
};

export type TransacaoHistoryItem = {
  id?: string;
  date: string;
  status: string;
  type: string;
  color: string;
  msg?: string | null;
};

export type TransacaoItem = {
  id?: string;
  name: string;
  quant: number;
  price: number;
};

export type TransacaoDetail = {
  coproducao?: TransacaoCoproducao | null;
  status: string;
  user?: { id: string; name: string; email: string };
  order: {
    id_transaction: string | null;
    date_register: string | null;
    type: string;
    origin: string | null;
    order_id: string | null;
    order_id_internal?: string;
    order_id_external?: string;
    installments: number | string;
    fee_total_value: number;
    mdr_value: number;
    fee_installment_value?: number;
    type_payment: string;
    client_name: string | null;
    client_document: string | null;
    client_email: string | null;
    client_phone: string | null;
    items: TransacaoItem[];
    total: number;
    total_liquid: number;
    valor_bruto_venda?: number;
    taxa_dom?: number;
    taxa_vendedor?: number;
    taxa_fixa_transacao?: number;
    taxa_cashback?: number;
    valor_liquido_vendedor?: number;
    lucro_master?: number;
    paid_date: string | null;
    pix_content?: string | null;
    historic_status: TransacaoHistoryItem[];
    msg_3ds?: string | null;
  };
};

export type ListTransacoesQuery = {
  page?: number;
  pageSize?: number;
  status?: string;
  q?: string;
  id?: string;
  customerName?: string;
  customerEmail?: string;
  customerDocument?: string;
  domTransactionId?: string;
  dataInicio?: string;
  dataFim?: string;
  periodType?: string;
  plataforma?: string;
  tipoTransacao?: string;
  paymentMethod?: string;
  acquirer?: string;
  enabled?: boolean;
};
