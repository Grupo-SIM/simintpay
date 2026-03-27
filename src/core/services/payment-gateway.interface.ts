export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

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

export type DomPlanFrequencyType = 'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR';

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
  register(input: DomRegisterInput): Promise<DomRegisterOutput>;
  generateToken(
    email: string,
    password: string,
  ): Promise<DomGenerateTokenOutput>;
  me(domToken: string): Promise<DomMeOutput>;

  createPaymentLink(
    domToken: string,
    input: DomPaymentLinkInput,
  ): Promise<DomPaymentLinkOutput>;
  listPaymentLinks(
    domToken: string,
    input: { page?: number; pageSize?: number },
  ): Promise<{ items: DomPaymentLinkOutput[]; total?: number }>;
  getPaymentLink(domToken: string, id: string): Promise<DomPaymentLinkOutput>;
  updatePaymentLink(
    domToken: string,
    id: string,
    input: Partial<DomPaymentLinkInput>,
  ): Promise<DomPaymentLinkOutput>;
  deletePaymentLink(domToken: string, id: string): Promise<void>;
  chargePaymentLink(
    domToken: string,
    input: {
      domLinkId: string;
      customerName: string;
      customerEmail: string;
      customerDocument: string;
      customerPhone: string;
      installments: number;
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
  ): Promise<{ id: string; status?: string }>;

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
  cancelSubscription(domToken: string, id: string): Promise<void>;
  getDomSummary(domToken: string): Promise<any>;
  getSpecificMachineTransactions(domToken: string): Promise<any>;
  getMonthlyRevenue(domToken: string): Promise<DomMonthlyRevenueOutput>;
  getTaxes(masterKey: string): Promise<DomTaxesOutput>;

  requestWithdraw(
    domToken: string,
    input: { amount: number; pixKey: string },
  ): Promise<DomRequestWithdrawOutput>;

  listDomTransactions(
    domToken: string,
    input: { page: number; limit: number; status?: string; begin_date?: string; end_date?: string },
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
      customer: { name: string; email: string; document: string; phone: string };
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
}
