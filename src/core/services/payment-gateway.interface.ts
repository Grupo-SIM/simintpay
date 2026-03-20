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
  webhookUrl?: string;
  redirectUrl?: string;
};

export type DomPlanOutput = {
  id: string;
  price?: number;
  description?: string;
  frequency_type?: DomPlanFrequencyType;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  createdAt?: string;
};

export type DomSubscriptionOutput = {
  id: string;
  status?: string;
  expiresAt?: string | null;
  planId?: string | null;
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
  cod_external?: string | null;
  created_at: string;
  updated_at?: string | null;
  amount: number;
  liquid_amount: number;
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
};

export type DomListTransactionsOutput = {
  transactions: DomTransactionItem[];
  total?: number;
  last_page?: number;
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

  getMonthlyRevenue(domToken: string): Promise<DomMonthlyRevenueOutput>;
  getTaxes(masterKey: string): Promise<DomTaxesOutput>;

  requestWithdraw(
    domToken: string,
    input: { amount: number; pixKey: string },
  ): Promise<DomRequestWithdrawOutput>;

  listDomTransactions(
    domToken: string,
    input: { page: number; limit: number },
  ): Promise<DomListTransactionsOutput>;

  getDomTransactionDetail(domToken: string, id: string): Promise<any>;

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
