export declare const PAYMENT_GATEWAY: unique symbol;
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
export interface IPaymentGateway {
    register(input: DomRegisterInput): Promise<DomRegisterOutput>;
    generateToken(email: string, password: string): Promise<DomGenerateTokenOutput>;
    me(domToken: string): Promise<DomMeOutput>;
    createPaymentLink(domToken: string, input: DomPaymentLinkInput): Promise<DomPaymentLinkOutput>;
    listPaymentLinks(domToken: string, input: {
        page?: number;
        pageSize?: number;
    }): Promise<{
        items: DomPaymentLinkOutput[];
        total?: number;
    }>;
    getPaymentLink(domToken: string, id: string): Promise<DomPaymentLinkOutput>;
    updatePaymentLink(domToken: string, id: string, input: Partial<DomPaymentLinkInput>): Promise<DomPaymentLinkOutput>;
    deletePaymentLink(domToken: string, id: string): Promise<void>;
    createPlan(domToken: string, input: DomCreatePlanInput): Promise<DomPlanOutput>;
    listPlans(domToken: string): Promise<DomPlanOutput[]>;
    deletePlan(domToken: string, id: string): Promise<void>;
    listSubscriptions(domToken: string, input: {
        page?: number;
        pageSize?: number;
    }): Promise<{
        items: DomSubscriptionOutput[];
        total?: number;
    }>;
    cancelSubscription(domToken: string, id: string): Promise<void>;
    getMonthlyRevenue(domToken: string): Promise<DomMonthlyRevenueOutput>;
    getTaxes(masterKey: string): Promise<DomTaxesOutput>;
    requestWithdraw(domToken: string, input: {
        amount: number;
        pixKey: string;
    }): Promise<DomRequestWithdrawOutput>;
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
    }): Promise<{
        data: {
            id: string;
        };
        message: string;
    }>;
}
