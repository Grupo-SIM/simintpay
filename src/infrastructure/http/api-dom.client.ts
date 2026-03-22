import { HttpService } from '@nestjs/axios';
import { Injectable, UnauthorizedException, HttpException, Logger } from '@nestjs/common';
import type { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  DomGenerateTokenOutput,
  DomCreatePlanInput,
  DomPaymentLinkInput,
  DomPaymentLinkOutput,
  DomMonthlyRevenueOutput,
  DomPlanOutput,
  DomSubscriptionOutput,
  DomTaxesOutput,
  DomRequestWithdrawOutput,
  DomMeOutput,
  DomRegisterInput,
  DomRegisterOutput,
  DomListTransactionsOutput,
  DomTransactionItem,
  DomWithdrawItem,
  DomListWithdrawsOutput,
  IPaymentGateway,
} from '../../core/services/payment-gateway.interface';

@Injectable()
export class ApiDomClient implements IPaymentGateway {
  private readonly logger = new Logger(ApiDomClient.name);

  constructor(private readonly http: HttpService) {}

  private toSafeString(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'string') return value.length > 0 ? value : null;
    if (typeof value === 'number')
      return Number.isFinite(value) ? String(value) : null;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'bigint') return value.toString();
    return null;
  }

  private getObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private pickString(
    obj: Record<string, unknown> | null,
    key: string,
  ): string | null {
    if (!obj) return null;
    const v = obj[key];
    return this.toSafeString(v);
  }

  private pickNestedString(
    obj: Record<string, unknown> | null,
    keys: string[],
  ): string | null {
    let cur: unknown = obj;
    for (const k of keys) {
      const o = this.getObject(cur);
      if (!o) return null;
      cur = o[k];
    }
    return this.toSafeString(cur);
  }

  private get baseUrl(): string {
    const base = process.env.DOM_REAL_API_URL ?? 'https://apiv3.dompagamentos.com.br/checkout/production';
    return base.replace(/\/$/, '');
  }

  private get domRealApiUrl(): string {
    const base = process.env.DOM_REAL_API_URL ?? 'https://apiv3.dompagamentos.com.br/checkout/production';
    return base.replace(/\/$/, '');
  }

  private normalizeDomApiResponse(data: Record<string, unknown>): Record<string, unknown> | null {
    const id = this.pickString(data, 'id');
    if (!id) return null;

    const feeDetails = this.getObject((data as any).fee_details ?? null);
    const feeAmount = this.pickNumber(feeDetails, 'amount') ?? 0;

    const amountCents = this.pickNumber(data, 'amount') ?? 0;
    const amount = amountCents / 100;

    const rawLiquidCents = this.pickNumber(data, 'liquid_amount');
    const totalLiquid = (rawLiquidCents != null && rawLiquidCents >= 0)
      ? rawLiquidCents / 100
      : amount - feeAmount;

    const status = this.pickString(data, 'status') ?? '';
    const isPaid = status === 'paid' || status === 'approved' || status === 'completed';
    const paymentMethod = this.pickString(data, 'payment_method') ?? '';
    const installments = Math.max(1, Math.round(this.pickNumber(data, 'installments') ?? 1));
    const isCard = /card|credit/i.test(paymentMethod);

    const CARD_RATES: Record<number, number> = {
      1: 0.0399, 2: 0.083,  3: 0.0968, 4: 0.1104, 5: 0.1237, 6: 0.1367,
      7: 0.1495, 8: 0.1621, 9: 0.1744, 10: 0.1864, 11: 0.1983, 12: 0.2099,
    };
    const mdrRate = isCard ? (CARD_RATES[installments] ?? 0.0399) : 0.0098;
    const mdrValue = parseFloat((amount * mdrRate).toFixed(2));

    const order: Record<string, unknown> = {
      order_id: this.pickString(data, 'cod_external') ?? id,
      id_transaction: id,
      type: status,
      type_payment: paymentMethod,
      date_register: this.pickString(data, 'created_at'),
      origin: 'DOM Pagamentos',
      total: amount,
      total_liquid: totalLiquid,
      fee_total_value: feeAmount,
      mdr_value: mdrValue,
      fee_installment_value: 0,
      paid_date: isPaid ? (this.pickString(data, 'updated_at') ?? null) : null,
      msg_3ds: null,
    };

    const customer = this.getObject((data as any).customer ?? (data as any).payer ?? null);
    if (customer) {
      order.client_name = this.pickString(customer, 'name');
      order.client_document = this.pickString(customer, 'document') ?? this.pickString(customer, 'cpf');
      order.client_email = this.pickString(customer, 'email');
      order.client_phone = this.pickString(customer, 'mobile_phone') ?? this.pickString(customer, 'phone') ?? this.pickString(customer, 'mobile');
    }

    order.pix_content = this.pickString(data, 'pix_content');

    const rawItems = Array.isArray(data.items) ? data.items : [];
    order.items = rawItems.length > 0
      ? rawItems.map((it: any) => ({ name: it.description ?? it.name ?? 'Produto', quant: it.quantity ?? it.quant ?? 1, price: (it.price ?? it.amount ?? 0) / 100 }))
      : [{ name: String((data as any).product_first ?? 'Produto'), quant: 1, price: amount }];

    const rawHistory = Array.isArray((data as any).status_history) ? (data as any).status_history : [];
    order.historic_status = rawHistory.length > 0
      ? rawHistory.map((h: any) => ({ status: h.status, type: h.type ?? h.status, date: h.created_at ?? h.date, color: '#3fa0e5' }))
      : [];

    return { order };
  }

  async register(input: DomRegisterInput): Promise<DomRegisterOutput> {
    const url = `${this.baseUrl}/auth/register`;
    const masterKey = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!masterKey) throw new Error('DOM Master Key not configured');

    try {
      const res = await firstValueFrom(this.http.post<unknown>(url, input, {
        headers: { 'Authorization': `Bearer ${masterKey}` }
      }));
      const root = this.getObject(res.data);
      const domUserId = this.pickString(root, 'domUserId') ?? this.pickNestedString(root, ['data', 'domUserId']) ?? this.pickString(root, 'id');

      if (!domUserId) throw new Error('api-dom register response missing domUserId');
      return { domUserId: String(domUserId) };
    } catch (error: any) {
      this.logger.error(`Register error: ${error?.response?.status} - ${JSON.stringify(error?.response?.data || error.message)}`);
      throw error;
    }
  }

  async generateToken(email: string, password: string): Promise<DomGenerateTokenOutput> {
    const url = `${this.baseUrl}/generate-token`;
    try {
      const res = await firstValueFrom(this.http.post<any>(url, { email, password }));
      const root = this.getObject(res.data);
      const domToken = this.pickString(root, 'token') ?? this.pickString(root, 'accessToken') ?? this.pickNestedString(root, ['data', 'token']);
      if (!domToken) throw new Error('Login failed: missing token');

      return {
        domToken: String(domToken),
        domUserId: this.pickString(root, 'userId') ?? this.pickNestedString(root, ['data', 'userId']) ?? undefined,
        name: this.pickString(root, 'name') ?? this.pickNestedString(root, ['data', 'name']) ?? undefined,
        email: this.pickString(root, 'email') ?? this.pickNestedString(root, ['data', 'email']) ?? undefined,
      };
    } catch (error: any) {
      this.logger.error(`Login error: ${error?.response?.status}`);
      throw new UnauthorizedException('Credenciais inválidas');
    }
  }

  async me(domToken: string): Promise<DomMeOutput> {
    const url = `${this.baseUrl}/auth/me`;
    try {
      const res = await firstValueFrom(this.http.get<any>(url, { headers: { 'Authorization': `Bearer ${domToken}` } }));
      const payload = this.getObject(res.data?.data ?? res.data);
      return {
        id: this.pickString(payload, 'id') ?? undefined,
        name: this.pickString(payload, 'name') ?? undefined,
        email: this.pickString(payload, 'email') ?? undefined,
      };
    } catch (error: any) {
      this.logger.error(`Me error: ${error?.response?.status}`);
      throw error;
    }
  }

  private pickNumber(obj: Record<string, unknown> | null, key: string): number | null {
    if (!obj) return null;
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private pickBoolean(obj: Record<string, unknown> | null, key: string): boolean | null {
    if (!obj) return null;
    const v = obj[key];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      if (v === 'true') return true;
      if (v === 'false') return false;
    }
    return null;
  }

  private getArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
  }

  private mapPaymentLink(obj: Record<string, unknown> | null): DomPaymentLinkOutput | null {
    const id = this.pickString(obj, 'id');
    if (!id) return null;
    return {
      id,
      title: this.pickString(obj, 'title') ?? undefined,
      description: this.pickString(obj, 'description') ?? undefined,
      amount: this.pickNumber(obj, 'amount') ?? undefined,
      maxInstallments: this.pickNumber(obj, 'maxInstallments') ?? undefined,
      isActive: this.pickBoolean(obj, 'isActive') ?? undefined,
      code: this.pickString(obj, 'code') ?? undefined,
      createdAt: this.pickString(obj, 'createdAt') ?? undefined,
    };
  }

  private mapPlan(obj: Record<string, unknown> | null): DomPlanOutput | null {
    const id = this.pickString(obj, 'id');
    if (!id) return null;
    return {
      id,
      price: this.pickNumber(obj, 'price') ?? undefined,
      description: this.pickString(obj, 'description') ?? undefined,
      frequency_type: this.pickString(obj, 'frequency_type') as any,
      webhookUrl: this.pickString(obj, 'webhookUrl'),
      redirectUrl: this.pickString(obj, 'redirectUrl'),
      createdAt: this.pickString(obj, 'createdAt') ?? undefined,
    };
  }

  private mapSubscription(obj: Record<string, unknown> | null): DomSubscriptionOutput | null {
    const id = this.pickString(obj, 'id');
    if (!id) return null;
    const customer = this.getObject(obj?.customer);
    return {
      id,
      status: this.pickString(obj, 'status') ?? undefined,
      expiresAt: this.pickString(obj, 'expiresAt'),
      planId: this.pickString(obj, 'planId'),
      customer: customer ? {
        name: this.pickString(customer, 'name') ?? undefined,
        email: this.pickString(customer, 'email') ?? undefined,
        document: this.pickString(customer, 'document') ?? undefined,
        phone: this.pickString(customer, 'phone') ?? undefined,
      } : undefined,
      createdAt: this.pickString(obj, 'createdAt') ?? undefined,
    };
  }

  async createPaymentLink(domToken: string, input: DomPaymentLinkInput): Promise<DomPaymentLinkOutput> {
    const url = `${this.baseUrl}/payment-links`;
    const res = await firstValueFrom(this.http.post<any>(url, input, { headers: { 'Authorization': `Bearer ${domToken}` } }));
    const mapped = this.mapPaymentLink(this.getObject(res.data?.data ?? res.data));
    if (!mapped) throw new Error('Invalid payment link response');
    return mapped;
  }

  async listPaymentLinks(domToken: string, input: { page?: number; pageSize?: number }): Promise<{ items: DomPaymentLinkOutput[]; total?: number }> {
    const url = `${this.baseUrl}/payment-links`;
    const res = await firstValueFrom(this.http.get<any>(url, { headers: { 'Authorization': `Bearer ${domToken}` }, params: input }));
    const root = this.getObject(res.data?.data ?? res.data);
    const arr = this.getArray(root?.items ?? root?.data ?? root);
    const items = (arr ?? []).map(x => this.mapPaymentLink(this.getObject(x))).filter((x): x is DomPaymentLinkOutput => !!x);
    return { items, total: this.pickNumber(root, 'total') ?? items.length };
  }

  async getPaymentLink(domToken: string, id: string): Promise<DomPaymentLinkOutput> {
    const url = `${this.baseUrl}/payment-links/${id}`;
    const res = await firstValueFrom(this.http.get<any>(url, { headers: { 'Authorization': `Bearer ${domToken}` } }));
    const mapped = this.mapPaymentLink(this.getObject(res.data?.data ?? res.data));
    if (!mapped) throw new Error('Invalid payment link response');
    return mapped;
  }

  async updatePaymentLink(domToken: string, id: string, input: Partial<DomPaymentLinkInput>): Promise<DomPaymentLinkOutput> {
    const url = `${this.baseUrl}/payment-links/${id}`;
    const res = await firstValueFrom(this.http.put<any>(url, input, { headers: { 'Authorization': `Bearer ${domToken}` } }));
    const mapped = this.mapPaymentLink(this.getObject(res.data?.data ?? res.data));
    if (!mapped) throw new Error('Invalid update response');
    return mapped;
  }

  async deletePaymentLink(domToken: string, id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.baseUrl}/payment-links/${id}`, { headers: { 'Authorization': `Bearer ${domToken}` } }));
  }

  async createPlan(domToken: string, input: DomCreatePlanInput): Promise<DomPlanOutput> {
    const url = `${this.baseUrl}/recurrence/plan`;
    const res = await firstValueFrom(this.http.post<any>(url, input, { headers: { 'Authorization': `Bearer ${domToken}` } }));
    const mapped = this.mapPlan(this.getObject(res.data?.data ?? res.data));
    if (!mapped) throw new Error('Invalid plan response');
    return mapped;
  }

  async listPlans(domToken: string): Promise<DomPlanOutput[]> {
    const url = `${this.baseUrl}/recurrence/plan`;
    const res = await firstValueFrom(this.http.get<any>(url, { headers: { 'Authorization': `Bearer ${domToken}` } }));
    const arr = this.getArray(res.data?.data ?? res.data);
    return (arr ?? []).map(x => this.mapPlan(this.getObject(x))).filter((x): x is DomPlanOutput => !!x);
  }

  async deletePlan(domToken: string, id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.baseUrl}/recurrence/plan/${id}`, { headers: { 'Authorization': `Bearer ${domToken}` } }));
  }

  async listSubscriptions(domToken: string, input: { page?: number; pageSize?: number }): Promise<{ items: DomSubscriptionOutput[]; total?: number }> {
    const url = `${this.baseUrl}/subscription`;
    const res = await firstValueFrom(this.http.get<any>(url, { headers: { 'Authorization': `Bearer ${domToken}` }, params: input }));
    const root = this.getObject(res.data?.data ?? res.data);
    const arr = this.getArray(root?.items ?? root?.data ?? root);
    const items = (arr ?? []).map(x => this.mapSubscription(this.getObject(x))).filter((x): x is DomSubscriptionOutput => !!x);
    return { items, total: this.pickNumber(root, 'total') ?? items.length };
  }

  async cancelSubscription(domToken: string, id: string): Promise<void> {
    await firstValueFrom(this.http.put(`${this.baseUrl}/subscription/${id}/cancel`, {}, { headers: { 'Authorization': `Bearer ${domToken}` } }));
  }

  async getMonthlyRevenue(domToken: string): Promise<DomMonthlyRevenueOutput> {
    const url = `${this.baseUrl}/payments/monthly-revenue`;
    const res = await firstValueFrom(this.http.get<any>(url, { headers: { 'Authorization': `Bearer ${domToken}` } }));
    const arr = this.getArray(res.data?.data ?? res.data);
    const items = (arr ?? []).map(x => {
      const o = this.getObject(x);
      const date = this.pickString(o, 'date');
      const value = this.pickNumber(o, 'value');
      return (date && value != null) ? { date, value } : null;
    }).filter((x): x is { date: string; value: number } => !!x);
    return { items };
  }

  async getTaxes(masterKey: string): Promise<DomTaxesOutput> {
    const url = `${this.baseUrl}/payments/taxes`;
    const res = await firstValueFrom(this.http.get<any>(url, { headers: { 'Authorization': `Bearer ${masterKey}` } }));
    return (res.data?.data ?? res.data) as DomTaxesOutput;
  }

  async requestWithdraw(domToken: string, input: { amount: number; pixKey: string }): Promise<DomRequestWithdrawOutput> {
    const url = `${this.baseUrl}/pixout`;
    const res = await firstValueFrom(this.http.post<any>(url, input, { headers: { 'Authorization': `Bearer ${domToken}` } }));
    const payload = this.getObject(res.data?.data ?? res.data);
    const requestId = this.pickString(payload, 'requestId') ?? this.pickString(payload, 'id');
    if (!requestId) throw new Error('Withdraw failure: missing ID');
    return {
      requestId,
      fee: this.pickNumber(payload, 'fee') ?? 0,
      netAmount: this.pickNumber(payload, 'netAmount') ?? (input.amount - (this.pickNumber(payload, 'fee') ?? 0)),
      totalAmount: this.pickNumber(payload, 'totalAmount') ?? input.amount,
      message: this.pickString(payload, 'message') ?? undefined,
    };
  }

  async listDomTransactions(domToken: string, input: { page: number; limit: number }): Promise<DomListTransactionsOutput> {
    const url = `${this.baseUrl}/transactions`;
    
    // A API v3 exige datas de início e fim. Vamos usar os últimos 30 dias como padrão.
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    const params: any = { 
      limit: input.limit,
      begin_date: formatDate(thirtyDaysAgo),
      end_date: formatDate(now)
    };
    if (input.page > 1) params.page = input.page;

    try {
      this.logger.log(`[DOM Client] GET ${url} Params: ${JSON.stringify(params)}`);
      const res = await firstValueFrom(this.http.get<any>(url, {
        headers: { 
          'Authorization': `Bearer ${domToken}`,
          'Origin': process.env.URL_APP || 'https://simpay.simintermediacoes.com',
          'Accept': 'application/json'
        },
        params,
      }));
      
      const root = this.getObject(res.data);
      const arr = 
        this.getArray(root?.transactions) ?? 
        this.getArray(root?.rows) ?? 
        this.getArray(root?.data) ?? 
        (Array.isArray(root) ? root : []);

      const transactions: DomTransactionItem[] = arr.map(x => {
        const o = this.getObject(x);
        const id = this.pickString(o, 'id') ?? this.pickString(o, 'id_transaction') ?? '';
        
        // Normalização de Valores (BFF trabalha sempre em REAIS)
        let amt = this.pickNumber(o, 'amount') ?? this.pickNumber(o, 'total') ?? 0;
        let liq = this.pickNumber(o, 'liquid_amount') ?? this.pickNumber(o, 'total_liquid') ?? 0;

        // Heurística de conversão Cêntimos -> Reais
        // Se o valor for muito alto (> 500) e não tiver decimal vindo da API checkout,
        // é provável que sejam centavos (ex: 3500).
        // Se vier da API Dashboard (front-store) ou tiver ponto decimal, já é Reais.
        const isCheckoutV3 = !!root?.transactions;
        const rawStr = String(o?.total || o?.amount || '');
        const hasDecimal = rawStr.includes('.') || rawStr.includes(',');

        if (isCheckoutV3 && amt >= 100 && !hasDecimal) {
          // Checkout V3 costuma mandar centavos
          this.logger.debug(`[Normalization] Guessing Cents for ID ${id}: ${amt} -> ${amt/100}`);
          amt = amt / 100;
          liq = liq / 100;
        } else {
          // Dashboard/front-store ou valor com decimal já é Reais
          this.logger.debug(`[Normalization] Keeping Reais for ID ${id}: ${amt}`);
        }

        return {
          id,
          order_id: this.pickString(o, 'order_id') ?? id,
          cod_external: this.pickString(o, 'cod_external'),
          created_at: this.pickString(o, 'created_at') ?? this.pickString(o, 'create_date') ?? new Date().toISOString(),
          updated_at: this.pickString(o, 'updated_at') ?? this.pickString(o, 'last_date'),
          amount: amt,
          liquid_amount: liq,
          mdr_value: this.pickNumber(o, 'mdr_value') ?? this.pickNumber(o, 'mdr'),
          status: this.pickString(o, 'status') ?? this.pickString(o, 'status_type') ?? 'pending',
          payment_method: this.pickString(o, 'payment_method') ?? this.pickString(o, 'type_payment') ?? 'pix',
          installments: this.pickNumber(o, 'installments') ?? 1,
          customer_name: this.pickString(o, 'customer_name') ?? this.pickString(o, 'client_name'),
          customer_email: this.pickString(o, 'customer_email') ?? this.pickString(o, 'client_email'),
          customer_phone: this.pickString(o, 'customer_phone') ?? this.pickString(o, 'client_phone'),
          customer_document: this.pickString(o, 'customer_document') ?? this.pickString(o, 'client_document'),
          product_first: this.pickString(o, 'product_first'),
        };
      }).filter(tx => tx.id.length > 0);

      return {
        transactions,
        total: this.pickNumber(root, 'total') ?? transactions.length,
      };
    } catch (error: any) {
      this.logger.error(`[DOM Client Error] status=${error?.response?.status} error=${JSON.stringify(error?.response?.data || error.message)}`);
      throw error;
    }
  }

  async getDomTransactionDetail(domToken: string, id: string): Promise<any> {
    const url = `${this.domRealApiUrl}/transactions/${id}`;
    try {
      const res = await firstValueFrom(this.http.get<any>(url, { headers: { 'Authorization': `Bearer ${domToken}` } }));
      const obj = this.getObject(res.data);
      if (obj) {
        const normalized = this.normalizeDomApiResponse(obj);
        if (normalized) return normalized;
      }
    } catch (err: any) {
      this.logger.warn(`Detail error ${id}: ${err.message}`);
    }
    throw new Error(`Transaction ${id} not found`);
  }

  async listDomWithdraws(domToken: string, input: { page: number; limit: number; status?: string }): Promise<DomListWithdrawsOutput> {
    const url = `${this.baseUrl}/pixout`;
    const params: any = { limit: input.limit, page: input.page };
    if (input.status) params.status = input.status;

    try {
      const res = await firstValueFrom(this.http.get<any>(url, { headers: { 'Authorization': `Bearer ${domToken}` }, params }));
      const root = this.getObject(res.data);
      const arr = this.getArray(root?.pixouts) ?? this.getArray(root?.withdraws) ?? this.getArray(root?.data) ?? (Array.isArray(root) ? root : []);

      const withdraws: DomWithdrawItem[] = arr.map(x => {
        const o = this.getObject(x);
        return {
          id_transfer: this.pickString(o, 'id') ?? this.pickString(o, 'id_transfer') ?? '',
          value: String(this.pickNumber(o, 'amount') ?? (this.pickNumber(o, 'value') != null ? (this.pickNumber(o, 'value')! / 100) : 0)),
          create_date: this.pickString(o, 'created_at') ?? this.pickString(o, 'create_date') ?? '',
          date_transfer: this.pickString(o, 'updated_at') ?? this.pickString(o, 'date_transfer') ?? '',
          bank_name: this.pickString(o, 'bank_name'),
          bank_agency: this.pickString(o, 'bank_agency'),
          bank_bill: this.pickString(o, 'bank_bill'),
          obs_client: this.pickString(o, 'obs_client'),
          status: this.pickString(o, 'status') ?? 'pending',
          type_transfer: this.pickString(o, 'type_transfer') ?? 'PIX',
          pix_key: this.pickString(o, 'pix_key') ?? this.pickString(o, 'recipient_key'),
          receivers: null,
        };
      });

      return {
        withdraws,
        total_results: this.pickNumber(root, 'total') ?? withdraws.length,
        total_pages: this.pickNumber(root, 'total_pages') ?? 1,
        page: input.page,
      };
    } catch (error: any) {
      this.logger.error(`Withdraws list error: ${error.message}`);
      return { withdraws: [], total_results: 0, total_pages: 0, page: input.page };
    }
  }

  async createLead(data: {
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
  }): Promise<{ data: { id: string }; message: string }> {
    return { data: { id: 'local-' + Date.now() }, message: 'Lead created locally' };
  }
}
