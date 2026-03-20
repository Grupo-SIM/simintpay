import { HttpService } from '@nestjs/axios';
import { DomGenerateTokenOutput, DomCreatePlanInput, DomPaymentLinkInput, DomPaymentLinkOutput, DomMonthlyRevenueOutput, DomPlanOutput, DomSubscriptionOutput, DomTaxesOutput, DomRequestWithdrawOutput, DomMeOutput, DomRegisterInput, DomRegisterOutput, DomListTransactionsOutput, IPaymentGateway } from '../../core/services/payment-gateway.interface';
export declare class ApiDomClient implements IPaymentGateway {
    private readonly http;
    constructor(http: HttpService);
    private toSafeString;
    private getObject;
    private pickString;
    private pickNestedString;
    private get baseUrl();
    private get domRealApiUrl();
    private normalizeDomApiResponse;
    register(input: DomRegisterInput): Promise<DomRegisterOutput>;
    generateToken(email: string, password: string): Promise<DomGenerateTokenOutput>;
    me(domToken: string): Promise<DomMeOutput>;
    private pickNumber;
    private pickBoolean;
    private getArray;
    private mapPaymentLink;
    private mapPlan;
    private mapSubscription;
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
    listDomTransactions(domToken: string, input: {
        page: number;
        limit: number;
    }): Promise<DomListTransactionsOutput>;
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
    getDomTransactionDetail(domToken: string, id: string): Promise<any>;
}
