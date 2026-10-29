export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * Tokens de injeção por adquirente. `PAYMENT_GATEWAY` (acima) continua sendo a
 * DOM, para retrocompatibilidade com os ~40 pontos que já o injetam. Os tokens
 * abaixo dão acesso explícito a uma implementação específica — usados pelo
 * PaymentGatewayResolver para rotear por loja.
 */
export const PAYMENT_GATEWAY_DOM = Symbol('PAYMENT_GATEWAY_DOM');
export const PAYMENT_GATEWAY_FRENDZ = Symbol('PAYMENT_GATEWAY_FRENDZ');

/**
 * ──────────────────────────────────────────────────────────────────────────
 * NOTA DE ARQUITETURA — múltiplas adquirentes
 *
 * Os tipos abaixo nasceram com o prefixo `Dom*` por terem sido modelados sobre
 * a API da DOM Pagamentos, a primeira adquirente. Com a entrada da Frendz como
 * segunda adquirente, esta interface passou a ser o CONTRATO NEUTRO que toda
 * adquirente implementa (DOM e Frendz hoje; outras no futuro).
 *
 * Para não quebrar os ~40 arquivos que já importam os nomes `Dom*`, mantemos
 * esses nomes como estão e expomos ALIASES neutros no final do arquivo
 * (`PaymentLinkInput`, `ChargePixInput`, ...). Código novo deve preferir os
 * aliases neutros; os `Dom*` permanecem válidos como sinônimos.
 * ──────────────────────────────────────────────────────────────────────────
 */

export type DomRegisterInput = {
  name: string;
  email: string;
  password: string;
};

export type DomRegisterOutput = {
  domUserId: string;
};

export type DomGenerateTokenOutput = {
  domToken: string;
  domUserId?: string;
  name?: string;
  email?: string;
};

export type DomMeOutput = {
  id?: string;
  name?: string;
  email?: string;
};

export type DomPaymentLinkInput = {
  title: string;
  description?: string | null;
  amount: number;
  maxInstallments?: number;
  isActive?: boolean;
  redirectUrl?: string;
  interestRateInstallment?: number;
  aceitaCartao?: boolean;
  aceitaPix?: boolean;
  /** Habilita boleto no link (paymentConfig.boleto na DOM). */
  aceitaBoleto?: boolean;
  /** Dias até o vencimento do boleto (paymentConfig.boletoExpireDay na DOM). */
  boletoExpireDay?: number;
};

export type DomPaymentLinkOutput = {
  id: string;
  title?: string;
  description?: string | null;
  amount?: number;
  maxInstallments?: number;
  isActive?: boolean;
  code?: string;
  createdAt?: string;
};

export type DomMonthlyRevenueItem = {
  date: string;
  value: number;
};

export type DomMonthlyRevenueOutput = {
  items: DomMonthlyRevenueItem[];
};

export type DomTaxesOutput = {
  pix?: {
    percentual?: number;
    fixo?: number;
    domFee?: string;
  };
  cartaoCredito?: {
    percentual?: number;
    fixo?: number;
    tabelaParcelas?: Array<{
      parcelas: number;
      taxaDom: string;
      total: string;
    }>;
  };
  saque?: {
    taxa?: number;
    minimo?: number;
    percentualLiquido?: number;
  };
};

export type DomRequestWithdrawOutput = {
  requestId: string;
  fee: number;
  netAmount: number;
  totalAmount: number;
  message?: string;
};

/** Valores aceitos pela DOM em /recurrence/plan (doc: DAY, WEEK, MONTH, YEAR). */
export type DomPlanFrequencyType = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export type DomCreatePlanInput = {
  price: number;
  description: string;
  frequency_type: DomPlanFrequencyType;
  frequency?: number;
  repetitions?: number;
  retry_days?: number;
  webhookUrl?: string;
  redirectUrl?: string;
};

export type DomPlanOutput = {
  id: string;
  price?: number;
  description?: string;
  frequency_type?: DomPlanFrequencyType;
  frequency?: number;
  repetitions?: number;
  retry_days?: number;
  status?: string;
  externalReference?: string;
  paymentMethods?: string[];
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  createdAt?: string;
};

export type DomSubscriptionOutput = {
  id: string;
  status?: string;
  expiresAt?: string | null;
  planId?: string | null;
  name?: string | null;
  description?: string | null;
  amount?: number | null;
  frequency?: string | null;
  interval?: number | null;
  cycle?: number | null;
  paymentMethod?: string | null;
  firstBillingDate?: string | null;
  customer?: {
    name?: string;
    email?: string;
    document?: string;
    phone?: string;
  };
  createdAt?: string;
};

/** Snapshot neutro necessário para reajustar uma recorrência existente. */
export type SubscriptionBillingSnapshot = {
  id: string;
  status: string;
  planId: string | null;
  customerId: string | null;
  cardToken: string;
  recurringAmount: number;
  frequencyType: string;
  frequency: number;
  nextInvoiceAt: string | null;
  /** Resultado da cobrança inicial de uma assinatura pré-paga, quando informado pela adquirente. */
  initialPaymentStatus?: string | null;
  initialPaymentMessage?: string | null;
};

export type StoredPaymentChargeInput = {
  subscriptionId: string;
  amount: number;
  description: string;
  codExternal: string;
  idempotencyKey: string;
  postbackUrl?: string;
};

export type StoredPaymentChargeOutput = {
  id: string;
  status: string;
  amount: number;
  netAmount?: number | null;
};

export type SubscriptionPlanChangeOutput = {
  subscriptionId: string;
  planId: string;
  status?: string;
};

export type DomTransactionItem = {
  id: string;
  order_id?: string | null;
  cod_external?: string | null;
  created_at: string;
  updated_at?: string | null;
  amount: number;
  liquid_amount: number;
  mdr_value?: number | null;
  status: string;
  status_details?: string | null;
  payment_method: string;
  installments?: number | null;
  card_bin?: string | null;
  card_brand?: string | null;
  pix_qrcode?: string | null;
  pix_content?: string | null;
  pix_expire?: string | null;
  customer_name?: string | null;
  customer_document?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  product_first?: string | null;
  fee_total?: number | null;
  dom_fee?: number | null;
};

export type DomListTransactionsOutput = {
  transactions: DomTransactionItem[];
  total?: number;
  last_page?: number;
};

export type DomWithdrawReceiver = {
  name: string | null;
  total: number;
  status: string;
  pix_key: string | null;
  external_id: string | null;
  receipt_url: string | null;
};

export type DomWithdrawItem = {
  id_transfer: string;
  create_date: string;
  date_transfer: string;
  value: string;
  bank_name: string | null;
  bank_agency: string | null;
  bank_bill: string | null;
  obs_client: string | null;
  status: string;
  type_transfer: string;
  pix_key: string | null;
  receivers: DomWithdrawReceiver[] | null;
};

export type DomListWithdrawsOutput = {
  withdraws: DomWithdrawItem[];
  total_results: number;
  total_pages: number;
  page: number;
};

export interface IPaymentGateway {
  createPaymentLink(
    domToken: string,
    input: DomPaymentLinkInput,
  ): Promise<DomPaymentLinkOutput>;
  updatePaymentLink(
    domToken: string,
    id: string,
    input: Partial<DomPaymentLinkInput>,
  ): Promise<DomPaymentLinkOutput>;
  deletePaymentLink(domToken: string, id: string): Promise<void>;
  chargePixForLink(
    domToken: string,
    input: {
      domLinkId: string;
      amount: number;
      description: string;
      customerName: string;
      customerEmail: string;
      customerDocument: string;
      customerPhone: string;
      documentType: 'CPF' | 'CNPJ';
      codExternal: string;
    },
  ): Promise<{
    id: string;
    status: string;
    pixContent: string | null;
    qrCode: string | null;
    pixExpire: string | null;
    amount: number;
  }>;

  chargeBoletoForLink(
    domToken: string,
    input: {
      amount: number;
      description: string;
      customerName: string;
      customerEmail: string;
      customerDocument: string;
      customerPhone: string;
      documentType: 'CPF' | 'CNPJ';
      codExternal: string;
      expireDays: number;
      address: {
        street: string;
        number: string;
        neighborhood: string;
        zipCode: string;
        city: string;
        uf: string;
        complement?: string;
      };
    },
  ): Promise<{
    id: string;
    status: string;
    boletoUrl: string | null;
    barcode: string | null;
    digitableLine: string | null;
    dueDate: string | null;
    amount: number;
  }>;

  chargePaymentLink(
    domToken: string,
    input: {
      domLinkId: string;
      amount: number;
      description: string;
      customerName: string;
      customerEmail: string;
      customerDocument: string;
      customerPhone: string;
      paymentMethod: 'credit_card' | 'debit_card' | 'pix';
      installments: number;
      card?: {
        token: string;
        brand?: string;
        bin?: string;
        exp_month: string;
        exp_year: string;
        cvv: string;
        holder_name: string;
        holder_document: string;
        number?: string;
      };
    },
  ): Promise<{ id: string; status?: string; pixContent?: string | null }>;

  createPlan(
    domToken: string,
    input: DomCreatePlanInput,
  ): Promise<DomPlanOutput>;
  listPlans(domToken: string): Promise<DomPlanOutput[]>;
  deletePlan(domToken: string, id: string): Promise<void>;

  listSubscriptions(
    domToken: string,
    input: { page?: number; pageSize?: number },
  ): Promise<{ items: DomSubscriptionOutput[]; total?: number }>;
  /** Detalhe bruto da assinatura na API DOM (recurrence/subscriptions/:id). */
  getSubscription(domToken: string, id: string): Promise<unknown>;
  getSubscriptionBillingSnapshot(
    domToken: string,
    id: string,
  ): Promise<SubscriptionBillingSnapshot>;
  chargeSubscriptionPaymentMethod(
    domToken: string,
    input: StoredPaymentChargeInput,
  ): Promise<StoredPaymentChargeOutput>;
  changeSubscriptionPlan(
    domToken: string,
    input: { subscriptionId: string; planId: string },
  ): Promise<SubscriptionPlanChangeOutput>;
  cancelSubscription(domToken: string, id: string): Promise<void>;
  reactivateSubscription(domToken: string, id: string): Promise<void>;
  getDomSummary(domToken: string): Promise<any>;
  getSpecificMachineTransactions(domToken: string): Promise<any>;
  listDomTransactions(
    domToken: string,
    input: {
      page: number;
      limit: number;
      status?: string;
      payment_method?: string;
      begin_date?: string;
      end_date?: string;
    },
  ): Promise<DomListTransactionsOutput>;

  listAllTransactionsDirectlyFromDom(params: {
    page?: number;
    limit?: number;
    status?: string;
    begin_date?: string;
    end_date?: string;
  }): Promise<any>;

  getDomTransactionDetail(domToken: string, id: string): Promise<any>;

  listDomWithdraws(
    domToken: string,
    input: { page: number; limit: number; status?: string },
  ): Promise<DomListWithdrawsOutput>;

  createSubscriptionFromCheckout(
    domToken: string,
    input: {
      planId: string;
      customer: {
        name: string;
        email: string;
        document: string;
        phone: string;
        documentType: 'CPF' | 'CNPJ';
      };
      card: {
        token: string;
        brand?: string;
        bin?: string;
        exp_month: string;
        exp_year: string;
        cvv: string;
        holder_name: string;
        holder_document: string;
        number?: string;
      };
    },
  ): Promise<{ id: string; status?: string; [key: string]: unknown }>;

  recoverSubscriptionCard?(
    domToken: string,
    input: {
      subscriptionId: string;
      card: {
        number: string;
        exp_month: string;
        exp_year: string;
        cvv: string;
        holder_name: string;
        holder_document: string;
      };
    },
  ): Promise<{ paymentId?: string; status?: string }>;

  createLead(data: {
    name: string;
    phone: string;
    email: string;
    razaoSocial: string;
    cnpj: string;
    faturamento: string;
    tempoOperacao: string;
    modeloOperacao?: string;
    cargo: string;
    comoConheceu?: string;
  }): Promise<{ data: { id: string }; message: string }>;

  createPixCheckout(
    domToken: string,
    input: {
      codExternal: string;
      amount: number;
      description: string;
      customerName: string;
      customerEmail: string;
      customerDocument: string;
      customerPhone: string;
      documentType: 'CPF' | 'CNPJ';
    },
  ): Promise<{
    id: string;
    status: string;
    pixContent: string | null;
    qrCode: string | null;
    pixExpire: string | null;
    amount: number;
  }>;
}

/**
 * ──────────────────────────────────────────────────────────────────────────
 * ALIASES NEUTROS (preferir em código novo)
 *
 * Sinônimos sem o prefixo `Dom*`, para que o contrato leia como agnóstico de
 * adquirente. Cada implementação (ApiDomClient, FrendzClient, ...) traduz
 * destes tipos para o formato específico da sua API.
 * ──────────────────────────────────────────────────────────────────────────
 */
export type PaymentLinkInput = DomPaymentLinkInput;
export type PaymentLinkOutput = DomPaymentLinkOutput;
export type CreatePlanInput = DomCreatePlanInput;
export type PlanOutput = DomPlanOutput;
export type SubscriptionOutput = DomSubscriptionOutput;
export type TransactionItem = DomTransactionItem;
export type ListTransactionsOutput = DomListTransactionsOutput;
export type RequestWithdrawOutput = DomRequestWithdrawOutput;
export type ListWithdrawsOutput = DomListWithdrawsOutput;
export type TaxesOutput = DomTaxesOutput;
export type MonthlyRevenueOutput = DomMonthlyRevenueOutput;

/** Resultado neutro de uma cobrança PIX (criar transação / checkout PIX). */
export type PixChargeResult = {
  id: string;
  status: string;
  pixContent: string | null;
  qrCode: string | null;
  pixExpire: string | null;
  amount: number;
};

/** Dados do cliente numa cobrança — comum a todas as adquirentes. */
export type PaymentCustomer = {
  name: string;
  email: string;
  document: string;
  phone: string;
  documentType: 'CPF' | 'CNPJ';
};

/** Contrato neutro do gateway (mesma forma de `IPaymentGateway`). */
export type IAcquirerGateway = IPaymentGateway;
