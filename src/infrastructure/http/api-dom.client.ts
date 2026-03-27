import { HttpService } from '@nestjs/axios';
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
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

  constructor(private readonly http: HttpService) { }

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
    const base = process.env.DOM_BACKEND_URL ?? 'https://api-dom.jbmidia.com';
    return base.replace(/\/$/, '');
  }

  private get paymentsUrl(): string {
    const base = process.env.DOM_PAYMENTS_API_URL ?? 'https://api-dom.jbmidia.com/payments';
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
      1: 0.0399, 2: 0.083, 3: 0.0968, 4: 0.1104, 5: 0.1237, 6: 0.1367,
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

    // DOM retorna o campo como "historic_status"; alguns fluxos legados usam "status_history"
    const rawHistory: any[] = Array.isArray((data as any).historic_status)
      ? (data as any).historic_status
      : Array.isArray((data as any).status_history)
        ? (data as any).status_history
        : [];
    order.historic_status = rawHistory.map((h: any) => ({
      status: h.status,
      type:   h.type ?? h.status,
      date:   h.date ?? h.created_at ?? h.date_register,
      color:  h.color ?? '#3fa0e5',
      msg:    h.msg ?? null,
    }));

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
      const res = await firstValueFrom(this.http.get<any>(url, {
        headers: {
          'Authorization': `Bearer ${domToken}`,
          'x-access-token': domToken
        }
      }));
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


  async getDomSummary(domToken: string): Promise<any> {
    const url = `${this.domRealApiUrl}/summary`;
    this.logger.log(`[DOM Diagnostic] Fetching summary from: ${url} with token: ${domToken.substring(0, 5)}...`);
    try {
      const res = await firstValueFrom(this.http.get<any>(url, {
        headers: {
          'Authorization': `Bearer ${domToken}`,
          'x-access-token': domToken,
          'Accept': 'application/json'
        }
      }));
      this.logger.log(`[DOM Diagnostic] Summary response status: ${res.status}`);
      return res.data?.data ?? res.data;
    } catch (error: any) {
      this.logger.error(`[DOM Error] summary URL: ${url} STATUS: ${error?.response?.status}`);
      if (error?.response?.data) {
        this.logger.error(`[DOM Error] response data: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async getSpecificMachineTransactions(domToken: string): Promise<any> {
    const url = `${this.paymentsUrl}/dom/specific-machines-transactions`;
    try {
      const res = await firstValueFrom(this.http.get<any>(url, {
        headers: {
          'Authorization': `Bearer ${domToken}`,
          'x-access-token': domToken,
          'Accept': 'application/json'
        }
      }));
      return res.data?.data ?? res.data;
    } catch (error: any) {
      this.logger.error(`Dom Machines error: ${error?.response?.status}`);
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
      price: this.pickNumber(obj, 'value') ?? undefined,
      description: this.pickString(obj, 'description') ?? undefined,
      frequency_type: this.pickString(obj, 'frequency_type') as any,
      frequency: this.pickNumber(obj, 'frequency') ?? undefined,
      repetitions: this.pickNumber(obj, 'repetitions') ?? undefined,
      status: this.pickString(obj, 'status') ?? undefined,
      externalReference: this.pickString(obj, 'external_reference') ?? undefined,
      paymentMethods: Array.isArray(obj?.payment_methods) ? (obj?.payment_methods as string[]) : undefined,
      webhookUrl: this.pickString(obj, 'postbackurl') ?? this.pickString(obj, 'webhookUrl'),
      redirectUrl: this.pickString(obj, 'redirectUrl'),
      createdAt: this.pickString(obj, 'created_at') ?? this.pickString(obj, 'createdAt') ?? undefined,
    };
  }

  private mapSubscription(obj: Record<string, unknown> | null): DomSubscriptionOutput | null {
    const id = this.pickString(obj, 'id');
    if (!id) return null;
    const active = obj?.active;
    return {
      id,
      status: active === true ? 'active' : active === false ? 'inactive' : undefined,
      expiresAt: this.pickString(obj, 'next_date_invoice'),
      planId: this.pickString(obj, 'plan_id') ?? undefined,
      name: this.pickString(obj, 'customer_name'),
      description: this.pickString(obj, 'description'),
      amount: this.pickNumber(obj, 'value'),
      frequency: this.pickString(obj, 'frequency_type'),
      interval: 1,
      cycle: this.pickNumber(obj, 'repetitions'),
      paymentMethod: this.pickString(obj, 'payment_method'),
      firstBillingDate: this.pickString(obj, 'start_date_invoice'),
      customer: undefined,
      createdAt: this.pickString(obj, 'created_at') ?? undefined,
    };
  }

  async createPaymentLink(domToken: string, input: DomPaymentLinkInput): Promise<DomPaymentLinkOutput> {
    const url = `${this.domRealApiUrl}/set-payment-link`;
    const body: any = {
      title: input.title,
      description: input.description ?? '',
      actived: true,
      limit: 0,
      products: [
        { name: input.title ?? 'Produto', price: input.amount ?? 0, min: 1, max: 1 },
      ],
      paymentConfig: {
        pix: input.aceitaPix ?? true,
        credit: input.aceitaCartao ?? true,
        boleto: false,
        installments: input.maxInstallments ?? 1,
        boletoExpireDay: 0,
        interest_rate_installment: input.interestRateInstallment ?? 0,
      },
    };
    if (input.redirectUrl) body.redirect_url = input.redirectUrl;
    const res = await firstValueFrom(this.http.post<any>(url, body, {
      headers: { 'Authorization': `Bearer ${domToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    }));
    this.logger.log(`[DOM Create Link RAW] ${JSON.stringify(res.data)}`);
    const root = res.data;
    const id = root?.id ?? root?.data?.id;
    const link = root?.link ?? root?.data?.link ?? '';
    if (!id) throw new Error('Invalid payment link response: missing id');
    return {
      id,
      title: input.title,
      description: input.description ?? undefined,
      amount: input.amount,
      maxInstallments: input.maxInstallments,
      isActive: true,
      code: link,
      createdAt: new Date().toISOString(),
    };
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

  async chargePaymentLink(
    domToken: string,
    input: {
      domLinkId: string;
      customerName: string;
      customerEmail: string;
      customerDocument: string;
      customerPhone: string;
      paymentMethod: 'credit_card' | 'pix';
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
  ): Promise<{ id: string; status?: string; pixContent?: string | null }> {
    const url = `${this.domRealApiUrl}/set-payment-link/${input.domLinkId}/charge`;
    const body: any = {
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        document: input.customerDocument,
        phone: input.customerPhone,
      },
      payment_method: input.paymentMethod,
      installments: input.installments,
    };
    if (input.paymentMethod === 'credit_card' && input.card) {
      body.card = {
        token: input.card.token,
        brand: input.card.brand,
        bin: input.card.bin,
        exp_month: input.card.exp_month,
        exp_year: input.card.exp_year,
        cvv: input.card.cvv,
        holder_name: input.card.holder_name,
        holder_document: input.card.holder_document,
        number: input.card.number,
      };
    }
    const res = await firstValueFrom(this.http.post<any>(url, body, {
      headers: { 'Authorization': `Bearer ${domToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    }));
    this.logger.log(`[DOM Charge Link RAW] ${JSON.stringify(res.data)}`);
    const root = res.data?.data ?? res.data;
    const id = root?.id ?? root?.transaction_id;
    if (!id) throw new Error('Charge response missing id');
    const pixContent = root?.pix_content ?? root?.pixContent ?? null;
    return { id, status: root?.status, pixContent };
  }

  async createPlan(domToken: string, input: DomCreatePlanInput): Promise<DomPlanOutput> {
    const url = `${this.domRealApiUrl}/recurrence/plan`;
    const body: any = {
      description: input.description,
      value: input.price,
      frequency: input.frequency ?? 1,
      frequency_type: input.frequency_type,
      repetitions: input.repetitions ?? 0,
      payment_methods: ['credit_card'],
      installments: 1,
      billing_type: 'prepaid',
      billing_day: 0,
      trial_period_days: 0,
      retry_days: input.retry_days ?? 3,
    };
    if (input.webhookUrl) body.postbackurl = input.webhookUrl;
    const res = await firstValueFrom(this.http.post<any>(url, body, {
      headers: { 'Authorization': `Bearer ${domToken}`, 'Content-Type': 'application/json' },
    }));
    this.logger.log(`[DOM Create Plan RAW] ${JSON.stringify(res.data)}`);
    const mapped = this.mapPlan(this.getObject(res.data?.data ?? res.data));
    if (!mapped) throw new Error('Invalid plan response');
    return mapped;
  }

  async listPlans(domToken: string): Promise<DomPlanOutput[]> {
    const url = `${this.domRealApiUrl}/recurrence/plan`;
    const res = await firstValueFrom(this.http.get<any>(url, {
      headers: { 'Authorization': `Bearer ${domToken}`, 'Accept': 'application/json' },
    }));
    const arr = this.getArray(res.data?.data ?? res.data);
    return (arr ?? []).map(x => this.mapPlan(this.getObject(x))).filter((x): x is DomPlanOutput => !!x);
  }

  async deletePlan(domToken: string, id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.domRealApiUrl}/recurrence/plan/${id}`, { headers: { 'Authorization': `Bearer ${domToken}` } }));
  }

  async listSubscriptions(domToken: string, input: { page?: number; pageSize?: number }): Promise<{ items: DomSubscriptionOutput[]; total?: number }> {
    const url = `${this.domRealApiUrl}/recurrence/subscriptions`;
    const params: any = {};
    if (input.page) params.page = input.page;
    if (input.pageSize) params.limit = input.pageSize;
    const res = await firstValueFrom(this.http.get<any>(url, {
      headers: { 'Authorization': `Bearer ${domToken}`, 'Accept': 'application/json' },
      params,
    }));
    const root = res.data;
    this.logger.log(`[DOM Subscriptions RAW] ${JSON.stringify(root).substring(0, 500)}`);
    const arr = this.getArray(root?.data ?? root?.items ?? root) ?? [];
    if (arr.length > 0) {
      this.logger.log(`[DOM Subscriptions FIRST ITEM] ${JSON.stringify(arr[0])}`);
    }
    const items = arr.map(x => this.mapSubscription(this.getObject(x))).filter((x): x is DomSubscriptionOutput => !!x);
    return { items, total: this.pickNumber(this.getObject(root), 'total') ?? items.length };
  }

  async cancelSubscription(domToken: string, id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.domRealApiUrl}/recurrence/subscriptions/${id}`, { headers: { 'Authorization': `Bearer ${domToken}` } }));
  }

  async createSubscriptionFromCheckout(
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
  ): Promise<{ id: string; status?: string; [key: string]: unknown }> {
    const url = `${this.domRealApiUrl}/recurrence/subscriptions`;
    const body = {
      plan_id: input.planId,
      payment_method: 'credit_card',
      customer: {
        name: input.customer.name,
        email: input.customer.email,
        document: input.customer.document,
        phone: input.customer.phone,
      },
      card: {
        token: input.card.token,
        brand: input.card.brand,
        bin: input.card.bin,
        exp_month: input.card.exp_month,
        exp_year: input.card.exp_year,
        cvv: input.card.cvv,
        holder_name: input.card.holder_name,
        holder_document: input.card.holder_document,
      },
    };
    const res = await firstValueFrom(
      this.http.post<any>(url, body, {
        headers: { Authorization: `Bearer ${domToken}`, 'Content-Type': 'application/json' },
      }),
    );
    const data = res.data?.data ?? res.data;
    const id = this.pickString(this.getObject(data), 'id') ?? String(Date.now());
    return { id, status: this.pickString(this.getObject(data), 'status') ?? 'pending', ...(this.getObject(data) ?? {}) };
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

  async listDomTransactions(
    domToken: string,
    input: { page: number; limit: number; status?: string; begin_date?: string; end_date?: string },
  ): Promise<DomListTransactionsOutput> {
    const url = `${this.domRealApiUrl}/transactions`;

    const params: any = {
      limit: input.limit,
      page: input.page,
    };
    if (input.status) params.status = input.status;
    if (input.begin_date) params.begin_date = input.begin_date;
    if (input.end_date) {
      params.end_date = input.end_date;
    } else if (input.begin_date) {
      params.end_date = '2026-12-31'; // Safe default for range
    }

    try {
      this.logger.log(`[DOM List] GET ${url} Token=${domToken.substring(0, 5)}... Params=${JSON.stringify(params)}`);
      const res = await firstValueFrom(this.http.get<any>(url, {
        headers: {
          'Authorization': `Bearer ${domToken}`,
          'x-access-token': domToken, // Alguns legados v2 usam esse header
          'Accept': 'application/json'
        },
        params,
      }));

      const root = res.data;
      const arr = Array.isArray(root?.data) ? root.data : (Array.isArray(root?.transactions) ? root.transactions : (Array.isArray(root) ? root : []));
      this.logger.log(`[DOM List] Received ${arr.length} items from ${url}`);

      const transactions: DomTransactionItem[] = arr.map((o: any) => {
        const id = this.pickString(o, 'id') ?? this.pickString(o, 'order_id') ?? '';
        
        let amt = this.pickNumber(o, 'amount') ?? this.pickNumber(o, 'total') ?? this.pickNumber(o, 'valor_bruto') ?? 0;
        let liq = this.pickNumber(o, 'liquid_amount') ?? this.pickNumber(o, 'amountWithoutAllFee') ?? this.pickNumber(o, 'total_liquido') ?? this.pickNumber(o, 'amountWithoutFee') ?? amt;
        
        // Se amortized_fee_total existe e liquid_amount é 0, calcula
        if (liq === 0 && amt > 0 && (this.pickNumber(o, 'fee') ?? 0) > 0) {
           liq = amt - (this.pickNumber(o, 'fee') ?? 0);
        }

        const customer = this.getObject(o.customer) || o;

        return {
          id,
          order_id: this.pickString(o, 'paymentId') ?? this.pickString(o, 'order_id') ?? this.pickString(o, 'id') ?? id,
          cod_external: this.pickString(o, 'cod_external') ?? this.pickString(o, 'external_id'),
          created_at: this.pickString(o, 'created_at') ?? this.pickString(o, 'createdAt') ?? this.pickString(o, 'create_date') ?? new Date().toISOString(),
          updated_at: this.pickString(o, 'updated_at') ?? this.pickString(o, 'updatedAt'),
          amount: amt,
          liquid_amount: liq,
          status: this.pickString(o, 'status') ?? 'pending',
          payment_method: this.pickString(o, 'payment_method') ?? this.pickString(o, 'method') ?? 'pix',
          installments: this.pickNumber(o, 'installments') ?? 1,
          customer_name: this.pickString(customer, 'name') ?? this.pickString(customer, 'customer_name'),
          customer_email: this.pickString(customer, 'email') ?? this.pickString(customer, 'customer_email'),
          customer_phone: this.pickString(customer, 'mobile_phone') ?? this.pickString(customer, 'phone') ?? this.pickString(customer, 'customer_phone'),
          customer_document: this.pickString(customer, 'document') ?? this.pickString(customer, 'customer_document'),
          product_first: (Array.isArray(o?.items) && o.items.length > 0) ? (o.items[0]?.description || o.items[0]?.name || null) : (this.pickString(o, 'description') || null),
          fee_total: amt - liq,
          dom_fee: this.pickNumber(o, 'dom_fee') ?? this.pickNumber(o, 'fee_dom') ?? 0,
        };
      }).filter((tx: DomTransactionItem) => tx.id.length > 0);

      return {
        transactions,
        total: this.pickNumber(root, 'total') ?? transactions.length,
      };
    } catch (error: any) {
      this.logger.error(`[DOM Direct Error] status=${error?.response?.status} error=${JSON.stringify(error?.response?.data || error.message)}`);
      throw error;
    }
  }

  async listAllTransactionsDirectlyFromDom(params: {
    page?: number;
    limit?: number;
    status?: string;
    begin_date?: string;
    end_date?: string;
  }): Promise<any> {
    const url = `${this.domRealApiUrl}/transactions`;
    const domToken = process.env.API_DOM_MASTER_KEY || process.env.DOM_TOKEN;

    if (!domToken) {
      throw new Error('DOM Token not configured in Simpay');
    }

    try {
      this.logger.log(`[DOM Direct Master] GET ${url} Params: ${JSON.stringify(params)}`);
      const res = await firstValueFrom(this.http.get<any>(url, {
        headers: {
          'Authorization': `Bearer ${domToken}`,
          'x-access-token': domToken,
          'Accept': 'application/json'
        },
        params
      }));
      return res.data;
    } catch (error: any) {
      this.logger.error(`[DOM Direct Master Error] status=${error?.response?.status} error=${JSON.stringify(error?.response?.data || error.message)}`);
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
    const url = `${this.paymentsUrl}/withdrawals`;
    const params: any = { limit: input.limit, page: input.page };
    if (input.status) params.status = input.status;

    try {
      const res = await firstValueFrom(this.http.get<any>(url, {
        headers: {
          'Authorization': `Bearer ${domToken}`,
          'x-access-token': domToken
        },
        params
      }));
      const root = this.getObject(res.data);
      const arr = this.getArray(root?.withdrawals) ?? this.getArray(root?.withdraws) ?? this.getArray(root?.pixouts) ?? this.getArray(root?.data) ?? (Array.isArray(root) ? root : []);

      this.logger.log(`DOM: Encontrados ${arr.length} saques na página ${input.page}`);

      const withdraws: DomWithdrawItem[] = arr.map(x => {
        const o = this.getObject(x);
        return {
          id_transfer: this.pickString(o, 'id') ?? this.pickString(o, 'id_transfer') ?? '',
          value: String(this.pickNumber(o, 'amount') ?? this.pickNumber(o, 'value') ?? 0),
          create_date: this.pickString(o, 'createdAt') ?? this.pickString(o, 'created_at') ?? this.pickString(o, 'create_date') ?? '',
          date_transfer: this.pickString(o, 'updatedAt') ?? this.pickString(o, 'updated_at') ?? this.pickString(o, 'date_transfer') ?? '',
          bank_name: this.pickString(o, 'bank_name'),
          bank_agency: this.pickString(o, 'bank_agency'),
          bank_bill: this.pickString(o, 'bank_bill'),
          obs_client: this.pickString(o, 'obs_client'),
          status: this.pickString(o, 'status') ?? 'pending',
          type_transfer: this.pickString(o, 'type_transfer') ?? 'PIX',
          pix_key: this.pickString(o, 'pixKey') ?? this.pickString(o, 'pix_key') ?? this.pickString(o, 'recipient_key'),
          receivers: Array.isArray(o?.receivers) ? (o as any).receivers : null,
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

  async createLead(_data: {
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
