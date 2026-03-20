import { HttpService } from '@nestjs/axios';
import { Injectable, UnauthorizedException } from '@nestjs/common';
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
  IPaymentGateway,
} from '../../core/services/payment-gateway.interface';

@Injectable()
export class ApiDomClient implements IPaymentGateway {
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
    const base = process.env.API_DOM_URL ?? 'http://localhost:3333';
    return base.replace(/\/$/, '');
  }

  /** URL base da API real do DOM Pagamentos */
  private get domRealApiUrl(): string {
    const base = process.env.DOM_REAL_API_URL ?? 'https://apiv3.dompagamentos.com.br/checkout/production';
    return base.replace(/\/$/, '');
  }

  /** Normaliza resposta bruta da API real do DOM para o formato { order: {...} } */
  private normalizeDomApiResponse(data: Record<string, unknown>): Record<string, unknown> | null {
    // A API real retorna o objeto de transação diretamente (sem wrapper "order")
    const id = this.pickString(data, 'id');
    if (!id) return null;

    // Taxa: a DOM retorna em fee_details.amount (objeto aninhado) — já em reais
    const feeDetails = this.getObject((data as any).fee_details ?? null);
    const feeAmount = this.pickNumber(feeDetails, 'amount') ?? 0;

    // amount e liquid_amount vêm em centavos — converter para reais
    const amountCents = this.pickNumber(data, 'amount') ?? 0;
    const amount = amountCents / 100;

    // liquid_amount = -1 significa liquidação pendente; calcula manualmente
    const rawLiquidCents = this.pickNumber(data, 'liquid_amount');
    const totalLiquid = (rawLiquidCents != null && rawLiquidCents >= 0)
      ? rawLiquidCents / 100
      : amount - feeAmount;

    const status = this.pickString(data, 'status') ?? '';
    const isPaid = status === 'paid' || status === 'approved' || status === 'completed';
    const paymentMethod = this.pickString(data, 'payment_method') ?? '';
    const installments = Math.max(1, Math.round(this.pickNumber(data, 'installments') ?? 1));
    const isCard = /card|credit/i.test(paymentMethod);

    // Calcular MDR (parte percentual da taxa) com as mesmas taxas do api-dom
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

    // Cliente
    const customer = this.getObject((data as any).customer ?? (data as any).payer ?? null);
    if (customer) {
      order.client_name = this.pickString(customer, 'name');
      order.client_document = this.pickString(customer, 'document') ?? this.pickString(customer, 'cpf');
      order.client_email = this.pickString(customer, 'email');
      order.client_phone = this.pickString(customer, 'mobile_phone') ?? this.pickString(customer, 'phone') ?? this.pickString(customer, 'mobile');
    }

    // PIX
    order.pix_content = this.pickString(data, 'pix_content');

    // Items
    const rawItems = Array.isArray(data.items) ? data.items : [];
    order.items = rawItems.length > 0
      ? rawItems.map((it: any) => ({ name: it.description ?? it.name ?? 'Produto', quant: it.quantity ?? it.quant ?? 1, price: (it.price ?? it.amount ?? 0) / 100 }))
      : [{ name: String((data as any).product_first ?? 'Produto'), quant: 1, price: amount }];

    // Histórico de status
    const rawHistory = Array.isArray((data as any).status_history) ? (data as any).status_history : [];
    order.historic_status = rawHistory.length > 0
      ? rawHistory.map((h: any) => ({ status: h.status, type: h.type ?? h.status, date: h.created_at ?? h.date, color: '#3fa0e5' }))
      : [];

    return { order };
  }

  async register(input: DomRegisterInput): Promise<DomRegisterOutput> {
    const url = `${this.baseUrl}/auth/register`;

    const res = await firstValueFrom(this.http.post<unknown>(url, input));

    const root = this.getObject(res.data);
    const domUserId =
      this.pickString(root, 'domUserId') ??
      this.pickNestedString(root, ['data', 'domUserId']) ??
      this.pickString(root, 'id');

    if (!domUserId) {
      throw new Error('api-dom register response missing domUserId');
    }

    return { domUserId: String(domUserId) };
  }

  async generateToken(
    email: string,
    password: string,
  ): Promise<DomGenerateTokenOutput> {
    const url = `${this.baseUrl}/auth/generate-token`;

    try {
      const res = (await firstValueFrom(
        this.http.post(url, {
          email,
          password,
        }),
      )) as AxiosResponse<unknown>;

      const root = this.getObject(res.data);

      const domToken =
        this.pickString(root, 'token') ??
        this.pickString(root, 'accessToken') ??
        this.pickNestedString(root, ['data', 'token']) ??
        this.pickNestedString(root, ['data', 'accessToken']);

      if (!domToken) {
        throw new Error('api-dom generate-token response missing token');
      }

      const domUserId =
        this.pickString(root, 'userId') ??
        this.pickNestedString(root, ['data', 'userId']);
      const name =
        this.pickString(root, 'name') ??
        this.pickNestedString(root, ['data', 'name']);
      const outEmail =
        this.pickString(root, 'email') ??
        this.pickNestedString(root, ['data', 'email']);

      return {
        domToken: String(domToken),
        domUserId: domUserId ? String(domUserId) : undefined,
        name: name ? String(name) : undefined,
        email: outEmail ? String(outEmail) : undefined,
      };
    } catch {
      throw new UnauthorizedException('Credenciais inválidas');
    }
  }

  async me(domToken: string): Promise<DomMeOutput> {
    const url = `${this.baseUrl}/auth/me`;

    const res = await firstValueFrom(
      this.http.get<unknown>(url, { headers: { 'x-access-token': domToken } }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);

    return {
      id: this.pickString(payload, 'id') ?? undefined,
      name: this.pickString(payload, 'name') ?? undefined,
      email: this.pickString(payload, 'email') ?? undefined,
    };
  }

  private pickNumber(
    obj: Record<string, unknown> | null,
    key: string,
  ): number | null {
    if (!obj) return null;
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private pickBoolean(
    obj: Record<string, unknown> | null,
    key: string,
  ): boolean | null {
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

  private mapPaymentLink(
    obj: Record<string, unknown> | null,
  ): DomPaymentLinkOutput | null {
    const id = this.pickString(obj, 'id');
    if (!id) return null;
    return {
      id,
      title: this.pickString(obj, 'title') ?? undefined,
      description: (this.pickString(obj, 'description') ?? undefined) as
        | string
        | null
        | undefined,
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
      frequency_type: (this.pickString(obj, 'frequency_type') ?? undefined) as
        | DomPlanOutput['frequency_type']
        | undefined,
      webhookUrl: this.pickString(obj, 'webhookUrl'),
      redirectUrl: this.pickString(obj, 'redirectUrl'),
      createdAt: this.pickString(obj, 'createdAt') ?? undefined,
    };
  }

  private mapSubscription(
    obj: Record<string, unknown> | null,
  ): DomSubscriptionOutput | null {
    const id = this.pickString(obj, 'id');
    if (!id) return null;

    const customer = this.getObject(obj?.customer);

    return {
      id,
      status: this.pickString(obj, 'status') ?? undefined,
      expiresAt: this.pickString(obj, 'expiresAt'),
      planId: this.pickString(obj, 'planId'),
      customer: customer
        ? {
            name: this.pickString(customer, 'name') ?? undefined,
            email: this.pickString(customer, 'email') ?? undefined,
            document: this.pickString(customer, 'document') ?? undefined,
            phone: this.pickString(customer, 'phone') ?? undefined,
          }
        : undefined,
      createdAt: this.pickString(obj, 'createdAt') ?? undefined,
    };
  }

  async createPaymentLink(
    domToken: string,
    input: DomPaymentLinkInput,
  ): Promise<DomPaymentLinkOutput> {
    const url = `${this.baseUrl}/payment-links`;

    const res = await firstValueFrom(
      this.http.post<unknown>(url, input, {
        headers: { 'x-access-token': domToken },
      }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);

    const mapped = this.mapPaymentLink(payload);
    if (!mapped)
      throw new Error('api-dom create payment link response invalid');
    return mapped;
  }

  async listPaymentLinks(
    domToken: string,
    input: { page?: number; pageSize?: number },
  ): Promise<{ items: DomPaymentLinkOutput[]; total?: number }> {
    const url = `${this.baseUrl}/payment-links`;

    const res = await firstValueFrom(
      this.http.get<unknown>(url, {
        headers: { 'x-access-token': domToken },
        params: {
          page: input.page,
          pageSize: input.pageSize,
        },
      }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);
    const arr = this.getArray(payload?.items ?? payload?.data ?? payload);

    const items = (arr ?? [])
      .map((x) => this.mapPaymentLink(this.getObject(x)))
      .filter((x): x is DomPaymentLinkOutput => Boolean(x));

    const total =
      this.pickNumber(payload, 'total') ??
      this.pickNumber(root, 'total') ??
      this.pickNumber(payload, 'count') ??
      undefined;

    return { items, total };
  }

  async getPaymentLink(
    domToken: string,
    id: string,
  ): Promise<DomPaymentLinkOutput> {
    const url = `${this.baseUrl}/payment-links/${id}`;

    const res = await firstValueFrom(
      this.http.get<unknown>(url, {
        headers: { 'x-access-token': domToken },
      }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);

    const mapped = this.mapPaymentLink(payload);
    if (!mapped) throw new Error('api-dom get payment link response invalid');
    return mapped;
  }

  async updatePaymentLink(
    domToken: string,
    id: string,
    input: Partial<DomPaymentLinkInput>,
  ): Promise<DomPaymentLinkOutput> {
    const url = `${this.baseUrl}/payment-links/${id}`;

    const res = await firstValueFrom(
      this.http.put<unknown>(url, input, {
        headers: { 'x-access-token': domToken },
      }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);

    const mapped = this.mapPaymentLink(payload);
    if (!mapped)
      throw new Error('api-dom update payment link response invalid');
    return mapped;
  }

  async deletePaymentLink(domToken: string, id: string): Promise<void> {
    const url = `${this.baseUrl}/payment-links/${id}`;

    await firstValueFrom(
      this.http.delete(url, {
        headers: { 'x-access-token': domToken },
      }),
    );
  }

  async createPlan(
    domToken: string,
    input: DomCreatePlanInput,
  ): Promise<DomPlanOutput> {
    const url = `${this.baseUrl}/payments/pix-plan`;

    const res = await firstValueFrom(
      this.http.post<unknown>(url, input, {
        headers: { 'x-access-token': domToken },
      }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);
    const mapped = this.mapPlan(payload);
    if (!mapped) throw new Error('api-dom create plan response invalid');
    return mapped;
  }

  async listPlans(domToken: string): Promise<DomPlanOutput[]> {
    const url = `${this.baseUrl}/payments/pix-plan`;

    const res = await firstValueFrom(
      this.http.get<unknown>(url, {
        headers: { 'x-access-token': domToken },
      }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);
    const arr = this.getArray(payload?.items ?? payload?.data ?? payload);

    return (arr ?? [])
      .map((x) => this.mapPlan(this.getObject(x)))
      .filter((x): x is DomPlanOutput => Boolean(x));
  }

  async deletePlan(domToken: string, id: string): Promise<void> {
    const url = `${this.baseUrl}/payments/pix-plan/${id}`;
    await firstValueFrom(
      this.http.delete(url, {
        headers: { 'x-access-token': domToken },
      }),
    );
  }

  async listSubscriptions(
    domToken: string,
    input: { page?: number; pageSize?: number },
  ): Promise<{ items: DomSubscriptionOutput[]; total?: number }> {
    const url = `${this.baseUrl}/subscription`;

    const res = await firstValueFrom(
      this.http.get<unknown>(url, {
        headers: { 'x-access-token': domToken },
        params: {
          page: input.page,
          pageSize: input.pageSize,
        },
      }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);
    const arr = this.getArray(payload?.items ?? payload?.data ?? payload);

    const items = (arr ?? [])
      .map((x) => this.mapSubscription(this.getObject(x)))
      .filter((x): x is DomSubscriptionOutput => Boolean(x));

    const total =
      this.pickNumber(payload, 'total') ??
      this.pickNumber(root, 'total') ??
      this.pickNumber(payload, 'count') ??
      undefined;

    return { items, total };
  }

  async cancelSubscription(domToken: string, id: string): Promise<void> {
    const url = `${this.baseUrl}/subscription/${id}/cancel`;

    await firstValueFrom(
      this.http.put(url, undefined, {
        headers: { 'x-access-token': domToken },
      }),
    );
  }

  async getMonthlyRevenue(domToken: string): Promise<DomMonthlyRevenueOutput> {
    const url = `${this.baseUrl}/payments/monthly-revenue`;

    const res = await firstValueFrom(
      this.http.get<unknown>(url, { headers: { 'x-access-token': domToken } }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);
    const arr = this.getArray(payload?.items ?? payload?.data ?? payload);

    const items = (arr ?? [])
      .map((x) => {
        const o = this.getObject(x);
        if (!o) return null;
        const date = this.pickString(o, 'date');
        const value = this.pickNumber(o, 'value');
        if (!date || value == null) return null;
        return { date, value };
      })
      .filter((x): x is { date: string; value: number } => Boolean(x));

    return { items };
  }

  async getTaxes(masterKey: string): Promise<DomTaxesOutput> {
    const url = `${this.baseUrl}/payments/taxes`;

    const res = await firstValueFrom(
      this.http.get<unknown>(url, { headers: { 'x-access-token': masterKey } }),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);

    return payload as DomTaxesOutput;
  }

  async requestWithdraw(
    domToken: string,
    input: { amount: number; pixKey: string },
  ): Promise<DomRequestWithdrawOutput> {
    const url = `${this.baseUrl}/payments/withdraw`;

    const res = await firstValueFrom(
      this.http.post<unknown>(
        url,
        { amount: input.amount, pixKey: input.pixKey },
        { headers: { 'x-access-token': domToken } },
      ),
    );

    const root = this.getObject(res.data);
    const payload = this.getObject(root?.data ?? root);

    const requestId =
      this.pickString(payload, 'requestId') ??
      this.pickString(payload, 'id') ??
      this.pickString(root, 'requestId');
    const fee = this.pickNumber(payload, 'fee') ?? this.pickNumber(root, 'fee');
    const netAmount =
      this.pickNumber(payload, 'netAmount') ??
      this.pickNumber(root, 'netAmount');
    const totalAmount =
      this.pickNumber(payload, 'totalAmount') ??
      this.pickNumber(root, 'totalAmount');
    const message =
      this.pickString(payload, 'message') ?? this.pickString(root, 'message');

    if (!requestId || fee == null || netAmount == null || totalAmount == null) {
      throw new Error('api-dom request withdraw response invalid');
    }

    return {
      requestId,
      fee,
      netAmount,
      totalAmount,
      message: message ?? undefined,
    };
  }

  async listDomTransactions(
    domToken: string,
    input: { page: number; limit: number },
  ): Promise<DomListTransactionsOutput> {
    const url = `${this.baseUrl}/payments/dom/transactions`;

    const res = await firstValueFrom(
      this.http.get<unknown>(url, {
        headers: { 'x-access-token': domToken },
        params: { page: input.page, limit: input.limit, per_page: input.limit },
      }),
    );

    const root = this.getObject(res.data);
    const arr =
      this.getArray(root?.transactions) ??
      this.getArray(root?.data) ??
      this.getArray(root) ??
      [];

    const rawObjects = arr
      .map((x) => this.getObject(x))
      .filter((x): x is Record<string, unknown> => Boolean(x));

    if (rawObjects.length > 0) {
      console.log('[DOM List] First raw transaction keys:', Object.keys(rawObjects[0]));
      console.log('[DOM List] First raw transaction mdr_value:', rawObjects[0]['mdr_value']);
      console.log('[DOM List] First raw transaction id:', rawObjects[0]['id']);
      console.log('[DOM List] First raw transaction order_id:', rawObjects[0]['order_id']);
      console.log('[DOM List] First raw transaction cod_external:', rawObjects[0]['cod_external']);
      console.log('[DOM List] First raw transaction id_transaction:', rawObjects[0]['id_transaction']);
    }

    const transactions: DomTransactionItem[] = rawObjects
      .map((x): DomTransactionItem => ({
        id: this.pickString(x, 'id') ?? '',
        order_id: this.pickString(x, 'order_id'),
        cod_external: this.pickString(x, 'cod_external'),
        created_at:
          this.pickString(x, 'created_at') ?? new Date().toISOString(),
        updated_at: this.pickString(x, 'updated_at'),
        amount: this.pickNumber(x, 'amount') ?? 0,
        liquid_amount: this.pickNumber(x, 'liquid_amount') ?? 0,
        mdr_value: this.pickNumber(x, 'mdr_value'),
        status: this.pickString(x, 'status') ?? 'pending',
        status_details: this.pickString(x, 'status_details'),
        payment_method: this.pickString(x, 'payment_method') ?? 'pix',
        installments: this.pickNumber(x, 'installments') ?? 1,
        card_bin: this.pickString(x, 'card_bin'),
        card_brand: this.pickString(x, 'card_brand'),
        pix_qrcode: this.pickString(x, 'pix_qrcode'),
        pix_content: this.pickString(x, 'pix_content'),
        pix_expire: this.pickString(x, 'pix_expire'),
        customer_name: this.pickString(x, 'customer_name'),
        customer_document: this.pickString(x, 'customer_document'),
        customer_email: this.pickString(x, 'customer_email'),
        customer_phone: this.pickString(x, 'customer_phone'),
        product_first: this.pickString(x, 'product_first'),
      }))
      .filter((x) => x.id.length > 0);

    const total =
      this.pickNumber(root, 'total') ??
      this.pickNumber(root, 'count') ??
      undefined;

    const lastPage =
      this.pickNumber(root, 'last_page') ??
      this.pickNumber(root, 'pages') ??
      undefined;

    return {
      transactions,
      total: total ?? undefined,
      last_page: lastPage ?? undefined,
    };
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
    const masterKey = process.env.API_DOM_MASTER_KEY ?? 'MASTER_KEY_DOM_API';
    const url = `${this.baseUrl}/leads`;
    const res = await firstValueFrom(
      this.http.post(url, data, {
        headers: { 'x-access-token': masterKey },
      }),
    );
    return res.data;
  }
 
  async getDomTransactionDetail(
    domToken: string,
    id: string,
  ): Promise<any> {
    const domApiToken = process.env.DOM_TOKEN;

    // 1. API real do DOM Pagamentos (apiv3.dompagamentos.com.br) com Bearer token
    if (domApiToken) {
      const realUrl = `${this.domRealApiUrl}/transactions/${id}`;
      try {
        console.log(`[DOM Client] GET ${realUrl} (real API)`);
        const res = await firstValueFrom(
          this.http.get<any>(realUrl, {
            headers: { Authorization: `Bearer ${domApiToken}` },
          }),
        );
        const data = this.getObject(res.data);
        if (data) {
          // A API real retorna o objeto diretamente; normaliza para { order: {...} }
          const normalized = this.normalizeDomApiResponse(data);
          if (normalized?.order) {
            console.log(`[DOM Client] Success from real DOM API: ${realUrl}`);
            return normalized;
          }
        }
      } catch (err: any) {
        console.log(`[DOM Client] ${realUrl} → ${err?.response?.status ?? err?.message}`);
      }
    }

    // 2. Wrapper api-dom.jbmidia.com (fallback)
    const fallbackEndpoints = [
      `${this.baseUrl}/payments/dom/transactions/${id}`,
    ];

    for (const url of fallbackEndpoints) {
      try {
        console.log(`[DOM Client] GET ${url}`);
        const res = await firstValueFrom(
          this.http.get<any>(url, {
            headers: { 'x-access-token': domToken },
          }),
        );
        if (res.data?.status === 'OK' || res.data?.order || res.data?.id) {
          console.log(`[DOM Client] Success from ${url}`);
          return res.data;
        }
      } catch (err: any) {
        console.log(`[DOM Client] ${url} → ${err?.response?.status ?? err?.message}`);
      }
    }

    throw new Error(`Transaction ${id} not found in any Dom endpoint`);
  }
}
