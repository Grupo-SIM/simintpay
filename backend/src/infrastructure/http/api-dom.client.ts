import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';
import * as QRCode from 'qrcode';
import {
  DomCreatePlanInput,
  DomPaymentLinkInput,
  DomPaymentLinkOutput,
  DomPlanOutput,
  DomSubscriptionOutput,
  DomListTransactionsOutput,
  DomTransactionItem,
  IPaymentGateway,
  StoredCardTokenChargeInput,
  StoredPaymentChargeInput,
  StoredPaymentChargeOutput,
  SubscriptionBillingSnapshot,
  SubscriptionPlanChangeOutput,
} from '../../core/services/payment-gateway.interface';
import {
  isDomCashbackActive,
  syncedAcquirerCostReais,
} from '../../modules/platform-taxas/platform-taxas.store';

/** Cashback desligado é desativado ativamente em cada transação (requer autorização da DOM). */
const domCashbackPayment = () =>
  isDomCashbackActive() ? {} : { cashback_disabled: true };

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

  private get domRealApiUrl(): string {
    const base =
      process.env.DOM_REAL_API_URL ??
      'https://apiv3.dompagamentos.com.br/checkout/production';
    return base.replace(/\/$/, '');
  }

  private normalizeDomApiResponse(
    data: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const id = this.pickString(data, 'id');
    if (!id) return null;

    const feeDetails = this.getObject((data as any).fee_details ?? null);
    const feeAmount = this.pickNumber(feeDetails, 'amount') ?? 0;

    const amountCents = this.pickNumber(data, 'amount') ?? 0;
    const amount = amountCents / 100;

    const rawLiquidCents = this.pickNumber(data, 'liquid_amount');
    const totalLiquid =
      rawLiquidCents != null && rawLiquidCents >= 0
        ? rawLiquidCents / 100
        : amount - feeAmount;

    const status = this.pickString(data, 'status') ?? '';
    const isPaid =
      status === 'paid' || status === 'approved' || status === 'completed';
    const paymentMethod = this.pickString(data, 'payment_method') ?? '';
    const installments = Math.max(
      1,
      Math.round(this.pickNumber(data, 'installments') ?? 1),
    );
    const isCard = /card|credit/i.test(paymentMethod);

    const mdrValue = parseFloat(
      syncedAcquirerCostReais(
        isCard ? 'CREDIT_CARD' : 'PIX',
        'ONLINE',
        isCard ? Math.min(Math.max(installments, 1), 12) : 1,
        amount,
      ).pct.toFixed(2),
    );

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

    const customer = this.getObject(
      (data as any).customer ?? (data as any).payer ?? null,
    );
    if (customer) {
      order.client_name = this.pickString(customer, 'name');
      order.client_document =
        this.pickString(customer, 'document') ??
        this.pickString(customer, 'cpf');
      order.client_email = this.pickString(customer, 'email');
      order.client_phone =
        this.pickString(customer, 'mobile_phone') ??
        this.pickString(customer, 'phone') ??
        this.pickString(customer, 'mobile');
    }

    order.pix_content = this.pickString(data, 'pix_content');

    const rawItems = Array.isArray(data.items) ? data.items : [];
    order.items =
      rawItems.length > 0
        ? rawItems.map((it: any) => ({
            name: it.description ?? it.name ?? 'Produto',
            quant: it.quantity ?? it.quant ?? 1,
            price: (it.price ?? it.amount ?? 0) / 100,
          }))
        : [
            {
              name: String((data as any).product_first ?? 'Produto'),
              quant: 1,
              price: amount,
            },
          ];

    // DOM retorna o campo como "historic_status"; alguns fluxos legados usam "status_history"
    const rawHistory: any[] = Array.isArray((data as any).historic_status)
      ? (data as any).historic_status
      : Array.isArray((data as any).status_history)
        ? (data as any).status_history
        : [];
    order.historic_status = rawHistory.map((h: any) => ({
      status: h.status,
      type: h.type ?? h.status,
      date: h.date ?? h.created_at ?? h.date_register,
      color: h.color ?? '#3fa0e5',
      msg: h.msg ?? null,
    }));

    return { order };
  }

  async getDomSummary(domToken: string): Promise<any> {
    const url = `${this.domRealApiUrl}/summary`;
    this.logger.log(
      `[DOM Diagnostic] Fetching summary from: ${url} with token: ${domToken.substring(0, 5)}...`,
    );
    try {
      const res = await firstValueFrom(
        this.http.get<any>(url, {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'x-access-token': domToken,
            Accept: 'application/json',
          },
        }),
      );
      this.logger.log(
        `[DOM Diagnostic] Summary response status: ${res.status}`,
      );
      return res.data?.data ?? res.data;
    } catch (error: any) {
      this.logger.error(
        `[DOM Error] summary URL: ${url} STATUS: ${error?.response?.status}`,
      );
      if (error?.response?.data) {
        this.logger.error(
          `[DOM Error] response data: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
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
      retry_days: this.pickNumber(obj, 'retry_days') ?? undefined,
      status: this.pickString(obj, 'status') ?? undefined,
      externalReference:
        this.pickString(obj, 'external_reference') ?? undefined,
      paymentMethods: Array.isArray(obj?.payment_methods)
        ? (obj?.payment_methods as string[])
        : undefined,
      webhookUrl:
        this.pickString(obj, 'postbackurl') ??
        this.pickString(obj, 'webhookUrl'),
      redirectUrl: this.pickString(obj, 'redirectUrl'),
      createdAt:
        this.pickString(obj, 'created_at') ??
        this.pickString(obj, 'createdAt') ??
        undefined,
    };
  }

  private mapSubscription(
    obj: Record<string, unknown> | null,
  ): DomSubscriptionOutput | null {
    const id = this.pickString(obj, 'id');
    if (!id) return null;

    const activeRaw =
      obj?.active ??
      obj?.actived ??
      obj?.activated ??
      obj?.is_active ??
      obj?.isActive;
    const active =
      activeRaw === true ||
      activeRaw === 1 ||
      activeRaw === 'true' ||
      activeRaw === '1' ||
      activeRaw === 'active';
    const statusRaw = obj?.status ?? obj?.active_status ?? obj?.status_type;
    const status =
      typeof statusRaw === 'string'
        ? statusRaw.trim().toLowerCase()
        : statusRaw != null
          ? String(statusRaw).toLowerCase()
          : null;

    const isActuallyActive =
      active ||
      status === 'active' ||
      status === 'actived' ||
      status === 'activated' ||
      status === '1' ||
      status === 'true';

    if (!isActuallyActive && activeRaw) {
      this.logger.warn(
        `[DOM Mapping] Subscription ${id} mapped as INACTIVE but activeRaw=${activeRaw} status=${status}`,
      );
    }

    return {
      id,
      // Missing or new provider states must not become a confirmed deactivation.
      status: isActuallyActive ? 'active' : status || undefined,
      expiresAt:
        this.pickString(obj, 'next_date_invoice') ??
        this.pickString(obj, 'expires_at') ??
        this.pickString(obj, 'end_date_invoice'),
      planId:
        this.pickString(obj, 'plan_id') ??
        this.pickString(obj, 'dom_plan_id') ??
        this.pickString(obj, 'plano_id'),
      name:
        this.pickString(obj, 'customer_name') ?? this.pickString(obj, 'name'),
      description:
        this.pickString(obj, 'description') ??
        this.pickString(obj, 'plan_name'),
      amount:
        this.pickNumber(obj, 'value') ??
        this.pickNumber(obj, 'amount') ??
        this.pickNumber(obj, 'price'),
      frequency:
        this.pickString(obj, 'frequency_type') ??
        this.pickString(obj, 'interval_type') ??
        this.pickString(obj, 'period'),
      interval:
        this.pickNumber(obj, 'interval') ??
        this.pickNumber(obj, 'intervals') ??
        1,
      cycle:
        this.pickNumber(obj, 'current_cycle') ??
        this.pickNumber(obj, 'repetitions') ??
        this.pickNumber(obj, 'ciclo') ??
        0,
      paymentMethod:
        this.pickString(obj, 'payment_method') ??
        this.pickString(obj, 'type_payment') ??
        'credit_card',
      firstBillingDate:
        this.pickString(obj, 'start_date_invoice') ??
        this.pickString(obj, 'created_at') ??
        this.pickString(obj, 'create_date'),
      customer: {
        name:
          this.pickString(obj, 'customer_name') ??
          this.pickString(obj, 'name') ??
          '',
        email:
          this.pickString(obj, 'customer_email') ??
          this.pickString(obj, 'email') ??
          '',
        document:
          this.pickString(obj, 'customer_document') ??
          this.pickString(obj, 'customer_cpf') ??
          this.pickString(obj, 'document') ??
          '',
        phone:
          this.pickString(obj, 'customer_phone') ??
          this.pickString(obj, 'phone') ??
          '',
      },
      createdAt:
        this.pickString(obj, 'created_at') ??
        this.pickString(obj, 'create_date') ??
        this.pickString(obj, 'createdAt') ??
        undefined,
    };
  }

  async createPaymentLink(
    domToken: string,
    input: DomPaymentLinkInput,
  ): Promise<DomPaymentLinkOutput> {
    const url = `${this.domRealApiUrl}/set-payment-link`;
    const body: any = {
      title: input.title,
      description: input.description ?? '',
      actived: true,
      limit: 0,
      products: [
        {
          name: input.title ?? 'Produto',
          price: input.amount ?? 0,
          min: 1,
          max: 1,
        },
      ],
      paymentConfig: {
        pix: input.aceitaPix ?? true,
        credit: input.aceitaCartao ?? true,
        boleto: input.aceitaBoleto ?? false,
        installments: input.maxInstallments ?? 1,
        boletoExpireDay: input.boletoExpireDay ?? 0,
        interest_rate_installment: input.interestRateInstallment ?? 0,
      },
    };
    if (input.redirectUrl) body.redirect_url = input.redirectUrl;
    const res = await firstValueFrom(
      this.http.post<any>(url, body, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          'x-access-token': domToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }),
    );
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

  async updatePaymentLink(
    domToken: string,
    id: string,
    input: Partial<DomPaymentLinkInput>,
  ): Promise<DomPaymentLinkOutput> {
    // Endpoint direto da DOM Pagamentos (api-dom descontinuada para este fluxo)
    const url = `${this.domRealApiUrl}/edit-payment-link/${id}`;
    const payload: Record<string, unknown> = {};
    if (input.title !== undefined) payload.title = input.title;
    if (input.description !== undefined)
      payload.description = input.description;
    if (input.amount !== undefined) payload.amount = input.amount;
    if (input.maxInstallments !== undefined)
      payload.maxInstallments = input.maxInstallments;
    if (input.isActive !== undefined) payload.isActive = input.isActive;
    if (input.redirectUrl !== undefined)
      payload.redirectUrl = input.redirectUrl;

    const res = await firstValueFrom(
      this.http.put<any>(url, payload, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }),
    );

    return {
      id: this.pickString(this.getObject(res.data), 'id') ?? id,
      title: input.title,
      description: input.description ?? undefined,
      amount: input.amount,
      maxInstallments: input.maxInstallments,
      isActive: input.isActive,
    };
  }

  async deletePaymentLink(domToken: string, id: string): Promise<void> {
    // Endpoint direto da DOM Pagamentos (api-dom descontinuada para este fluxo)
    await firstValueFrom(
      this.http.delete(`${this.domRealApiUrl}/delete-payment-link/${id}`, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          Accept: 'application/json',
        },
      }),
    );
  }

  async chargePixForLink(
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
  }> {
    // DOM não suporta pix via set-payment-link/charge — usa /transactions direto
    const url = `${this.domRealApiUrl}/transactions`;

    const expireAt = new Date();
    expireAt.setHours(expireAt.getHours() + 24);
    const pixExpireFormatted = expireAt
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');

    const body = {
      cod_external: input.codExternal,
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        document: input.customerDocument.replace(/\D/g, ''),
        document_type: input.documentType,
        mobile_phone: input.customerPhone.replace(/\D/g, ''),
      },
      items: {
        description: input.description,
        price: input.amount,
        quantity: 1,
      },
      payment: {
        ...domCashbackPayment(),
        pix: { pix_expire: pixExpireFormatted },
        payment_method: 'pix',
        total: input.amount,
      },
    };

    this.logger.log(`[DOM PIX Link] POST ${url} amount=${input.amount}`);

    const res = await firstValueFrom(
      this.http.post<any>(url, body, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }),
    );

    this.logger.log(`[DOM PIX Link RAW] ${JSON.stringify(res.data)}`);

    const root = res.data?.data ?? res.data;
    const id =
      this.pickString(this.getObject(root), 'id') ??
      this.pickString(this.getObject(root), 'transaction_id');
    if (!id) throw new Error('DOM PIX: resposta sem id de transação');

    const pixContent =
      this.pickString(this.getObject(root), 'pix_content') ??
      this.pickString(this.getObject(root), 'pix_copy_paste') ??
      this.pickString(this.getObject(root), 'pixContent') ??
      null;

    let qrCode =
      this.pickString(this.getObject(root), 'qr_code') ??
      this.pickString(this.getObject(root), 'qr_code_text') ??
      null;

    // DOM não retorna QR code na resposta — gera a partir do pixContent
    if (!qrCode && pixContent) {
      try {
        qrCode = await QRCode.toDataURL(pixContent, { width: 256, margin: 2 });
      } catch (e) {
        this.logger.warn(`[DOM PIX Link] Falha ao gerar QR code: ${e}`);
      }
    }

    const pixExpire =
      this.pickString(this.getObject(root), 'pix_expire_at') ??
      this.pickString(this.getObject(root), 'pix_expire') ??
      pixExpireFormatted;

    return {
      id,
      status: this.pickString(this.getObject(root), 'status') ?? 'waiting',
      pixContent,
      qrCode,
      pixExpire,
      amount: input.amount,
    };
  }

  async chargeBoletoForLink(
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
  }> {
    // DOM: cria transação de boleto direto em /transactions (payment_method=boleto)
    const url = `${this.domRealApiUrl}/transactions`;

    const due = input.expireDays > 0 ? new Date() : null;
    due?.setDate(due.getDate() + input.expireDays);
    const dueDate = due?.toISOString().slice(0, 10) ?? null;

    const body = {
      cod_external: input.codExternal,
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        document: input.customerDocument.replace(/\D/g, ''),
        document_type: input.documentType,
        mobile_phone: input.customerPhone.replace(/\D/g, ''),
        // Endereço é OBRIGATÓRIO para boleto na DOM. street limitado a 40 chars.
        address: {
          street: (input.address.street ?? '').trim().slice(0, 40),
          number: (input.address.number ?? '').trim().slice(0, 10) || 'S/N',
          neighborhood: (input.address.neighborhood ?? '').trim().slice(0, 40),
          zip_code: (input.address.zipCode ?? '').replace(/\D/g, ''),
          city: (input.address.city ?? '').trim().slice(0, 40),
          state: (input.address.uf ?? '').trim().toUpperCase(),
          uf: (input.address.uf ?? '').trim().toUpperCase(),
          complement: (input.address.complement ?? '').trim().slice(0, 40),
        },
      },
      items: [
        {
          description: input.description,
          price: input.amount,
          quantity: 1,
        },
      ],
      payment: {
        ...domCashbackPayment(),
        // DOM: dias até o vencimento do boleto (campo correto = boleto_due_days).
        boleto:
          input.expireDays > 0 ? { boleto_due_days: input.expireDays } : {},
        payment_method: 'boleto',
        total: input.amount,
      },
    };

    this.logger.log(
      `[DOM Boleto] POST ${url} amount=${input.amount} due=${dueDate}`,
    );

    const res = await firstValueFrom(
      this.http.post<any>(url, body, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }),
    );

    this.logger.log(`[DOM Boleto RAW] ${JSON.stringify(res.data)}`);

    const root = this.getObject(res.data?.data ?? res.data);
    // Alguns campos podem vir aninhados em root.boleto — busca nos dois lugares.
    const boletoObj = this.getObject((root as any)?.boleto);
    const pick = (k: string): string | null =>
      this.pickString(root, k) ??
      (boletoObj ? this.pickString(boletoObj, k) : null);

    const id = pick('id') ?? pick('transaction_id');
    if (!id) throw new Error('DOM Boleto: resposta sem id de transação');

    const boletoUrl =
      pick('boleto_url') ??
      pick('boletoUrl') ??
      pick('url') ??
      pick('pdf') ??
      null;
    // DOM usa boleto_digitable_line (linha digitável); não há barcode separado.
    const digitableLine =
      pick('boleto_digitable_line') ??
      pick('digitable_line') ??
      pick('linha_digitavel') ??
      pick('boleto_line') ??
      null;
    const barcode =
      pick('barcode') ?? pick('bar_code') ?? pick('boleto_barcode') ?? null;
    const respDueDate =
      pick('due_date') ??
      pick('boleto_due_date') ??
      pick('expire_at') ??
      pick('boleto_expire') ??
      dueDate;

    return {
      id,
      status: pick('status') ?? 'waiting',
      boletoUrl,
      barcode,
      digitableLine,
      dueDate: respDueDate,
      amount: input.amount,
    };
  }

  async chargePaymentLink(
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
      upsell?: boolean;
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
    if (input.paymentMethod === 'pix') {
      throw new BadRequestException('Use a rota PIX do link de pagamento');
    }
    if (!input.card?.token) {
      throw new BadRequestException('Token do cartão obrigatório');
    }

    const url = `${this.domRealApiUrl}/transactions`;
    const document = input.customerDocument.replace(/\D/g, '');
    const body = {
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        document,
        document_type: document.length === 14 ? 'CNPJ' : 'CPF',
        mobile_phone: input.customerPhone.replace(/\D/g, ''),
      },
      items: [
        { description: input.description, price: input.amount, quantity: 1 },
      ],
      payment: {
        ...domCashbackPayment(),
        payment_method: input.paymentMethod,
        total: input.amount,
        [input.paymentMethod]: {
          token: input.card.token,
          installments:
            input.paymentMethod === 'debit_card' ? 1 : input.installments,
          ...(input.upsell && input.paymentMethod === 'credit_card'
            ? { upsell: true }
            : {}),
        },
      },
      metadata: JSON.stringify({ paymentLinkId: input.domLinkId }),
    };
    const res = await firstValueFrom(
      this.http.post<any>(url, body, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }),
    );

    const root = res.data?.data ?? res.data;
    const id = root?.id ?? root?.transaction_id;
    if (!id) throw new Error('Charge response missing id');
    const pixContent = root?.pix_content ?? root?.pixContent ?? null;
    return { id, status: root?.status, pixContent };
  }

  async createPlan(
    domToken: string,
    input: DomCreatePlanInput,
  ): Promise<DomPlanOutput> {
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
    // NOTE:
    // `postbackurl` e `redirectUrl` nao fazem parte do payload de criacao do plano
    // de recorrencia na DOM para este fluxo. Quando enviados, podem causar 400.
    // Esses campos continuam armazenados localmente no link/plano.
    let res: any;
    try {
      res = await firstValueFrom(
        this.http.post<any>(url, body, {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (err) {
      const ax = err as AxiosError<{
        msg?: string;
        message?: string;
        error?: string;
      }>;
      if (ax?.isAxiosError === true && ax.response?.data) {
        const data = ax.response.data as Record<string, unknown>;
        const msg =
          (typeof data.msg === 'string' && data.msg) ||
          (typeof data.message === 'string' && data.message) ||
          (typeof data.error === 'string' && data.error);
        if (msg) throw new BadRequestException(msg);
      }
      throw err;
    }
    this.logger.log(`[DOM Create Plan RAW] ${JSON.stringify(res.data)}`);
    const mapped = this.mapPlan(this.getObject(res.data?.data ?? res.data));
    if (!mapped) throw new Error('Invalid plan response');
    return mapped;
  }

  async listPlans(domToken: string): Promise<DomPlanOutput[]> {
    const url = `${this.domRealApiUrl}/recurrence/plan`;
    const res = await firstValueFrom(
      this.http.get<any>(url, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          Accept: 'application/json',
        },
      }),
    );
    const arr = this.getArray(res.data?.data ?? res.data);
    return (arr ?? [])
      .map((x) => this.mapPlan(this.getObject(x)))
      .filter((x): x is DomPlanOutput => !!x);
  }

  async deletePlan(domToken: string, id: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.domRealApiUrl}/recurrence/plan/${id}`, {
        headers: { Authorization: `Bearer ${domToken}` },
      }),
    );
  }

  async listSubscriptions(
    domToken: string,
    input: { page?: number; pageSize?: number },
  ): Promise<{ items: DomSubscriptionOutput[]; total?: number }> {
    // DomPagamentos ignora o parâmetro `limit` e sempre retorna ~100 itens por página DOM.
    // O admin-card-machine usa pageSize=20, então precisamos mapear a paginação do admin
    // para a paginação real do DOM (que retorna blocos de 100).
    const adminPage = input.page ?? 1;
    const requestedCount = input.pageSize ?? 21; // use-case passa pageSize+1 para detectar hasNextPage

    const DOM_PER_PAGE = 100;
    const globalStart = (adminPage - 1) * requestedCount;
    const globalEnd = globalStart + requestedCount;

    const domPageStart = Math.floor(globalStart / DOM_PER_PAGE) + 1;
    const domPageEnd =
      Math.floor(Math.max(globalEnd - 1, 0) / DOM_PER_PAGE) + 1;

    this.logger.log(
      `[Subscriptions] adminPage=${adminPage} requestedCount=${requestedCount} globalStart=${globalStart} domPages=${domPageStart}-${domPageEnd}`,
    );

    let allItems: unknown[] = [];
    let total: number | undefined;

    for (let domPage = domPageStart; domPage <= domPageEnd; domPage++) {
      this.logger.log(
        `[Subscriptions] Buscando DOM page=${domPage} token=${domToken.substring(0, 8)}...`,
      );
      const res = await firstValueFrom(
        this.http.get<any>(`${this.domRealApiUrl}/recurrence/subscriptions`, {
          headers: {
            Authorization: `Bearer ${domToken}`,
            Accept: 'application/json',
          },
          params: { page: domPage },
        }),
      );
      const root = res.data;
      if (domPage === domPageStart) {
        total =
          this.pickNumber(this.getObject(root), 'total_results') ??
          this.pickNumber(this.getObject(root), 'total') ??
          undefined;
      }
      const arr =
        this.getArray(
          root?.subscriptions ?? root?.data ?? root?.items ?? root,
        ) ?? [];
      this.logger.log(
        `[Subscriptions] DOM page=${domPage} retornou ${arr.length} itens (total_results=${total ?? 'N/A'})`,
      );
      allItems = allItems.concat(arr);
      if (arr.length < DOM_PER_PAGE) break;
    }

    const localStart = globalStart - (domPageStart - 1) * DOM_PER_PAGE;
    const pageSlice = allItems.slice(localStart, localStart + requestedCount);

    const items = pageSlice
      .map((x) => this.mapSubscription(this.getObject(x)))
      .filter((x): x is DomSubscriptionOutput => !!x);

    const activeCount = items.filter((i) => i.status === 'active').length;
    this.logger.log(
      `[Subscriptions] Retornando ${items.length} itens (ativos=${activeCount} inativos=${items.length - activeCount}) localStart=${localStart}`,
    );

    return { items, total: total ?? items.length };
  }

  async getSubscription(domToken: string, id: string): Promise<unknown> {
    const url = `${this.domRealApiUrl}/recurrence/subscriptions/${id}`;
    const res = await firstValueFrom(
      this.http.get<unknown>(url, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          Accept: 'application/json',
        },
      }),
    );
    const root = res.data as Record<string, unknown> | undefined;
    if (
      root &&
      typeof root === 'object' &&
      'data' in root &&
      root.data !== undefined
    ) {
      return root.data;
    }
    return res.data;
  }

  async getSubscriptionBillingSnapshot(
    domToken: string,
    id: string,
  ): Promise<SubscriptionBillingSnapshot> {
    const raw = this.getObject(await this.getSubscription(domToken, id));
    if (!raw) throw new BadRequestException('Assinatura inválida na DOM');

    const recurring = this.getObject(raw.auto_recurring);
    const card = this.getObject(raw.card);
    const cardToken = this.pickString(card, 'token');
    if (!cardToken) {
      throw new BadRequestException(
        'A assinatura não possui token de cartão disponível para cobrança avulsa',
      );
    }

    const recurringAmount = this.pickNumber(recurring, 'value');
    if (recurringAmount == null || recurringAmount < 0) {
      throw new BadRequestException(
        'A assinatura não possui valor recorrente válido',
      );
    }

    return {
      id: this.pickString(raw, 'id') ?? id,
      status: this.pickString(raw, 'status') ?? 'unknown',
      planId: this.pickString(raw, 'plan_id'),
      customerId: this.pickString(raw, 'customer_id'),
      cardToken,
      recurringAmount,
      frequencyType: this.pickString(recurring, 'frequency_type') ?? 'MONTH',
      frequency: Math.max(
        1,
        Math.round(this.pickNumber(recurring, 'frequency') ?? 1),
      ),
      // A DOM devolve as datas no objeto de recorrência. Alguns retornos
      // legados as trazem na raiz, então preservamos este fallback.
      nextInvoiceAt:
        this.pickString(recurring, 'next_date_invoice') ??
        this.pickString(raw, 'next_date_invoice'),
      initialPaymentStatus: this.pickString(raw, 'status_transaction_prepaid'),
      initialPaymentMessage: this.pickString(raw, 'msg_transaction_prepaid'),
    };
  }

  async chargeSubscriptionPaymentMethod(
    domToken: string,
    input: StoredPaymentChargeInput,
  ): Promise<StoredPaymentChargeOutput> {
    const subscription = await this.getSubscriptionBillingSnapshot(
      domToken,
      input.subscriptionId,
    );
    return this.postStoredCardTransaction(domToken, {
      cardToken: subscription.cardToken,
      amount: input.amount,
      description: input.description,
      codExternal: input.codExternal,
      idempotencyKey: input.idempotencyKey,
      postbackUrl: input.postbackUrl,
      metadata: { billing: true, subscriptionId: input.subscriptionId },
    });
  }

  /** Cashback avulso (Vale Bônus) sem transação DOM: serve compras de outras adquirentes. */
  async addStandaloneCashback(
    domToken: string,
    input: {
      valueReais: number;
      name: string;
      document: string;
      mobilePhone: string;
      codExternal: string;
      idempotencyKey: string;
    },
  ): Promise<{ status: 'delivered' | 'pending' }> {
    const res = await firstValueFrom(
      this.http.post<{ status?: string; msg?: string }>(
        `${this.domRealApiUrl}/cashback`,
        {
          value: input.valueReais,
          customer: {
            name: input.name,
            document: input.document,
            mobile_phone: input.mobilePhone,
          },
          cod_external: input.codExternal,
          idempotency_key: input.idempotencyKey,
        },
        {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        },
      ),
    );
    const status = res.data?.status;
    if (status !== 'delivered' && status !== 'pending')
      throw new BadRequestException(res.data?.msg ?? 'Cashback recusado');
    return { status };
  }

  /** Cobra um token do cofre da SimIntPay (mesma chamada de /transactions usada pelas assinaturas DOM). */
  async chargeStoredCardToken(
    domToken: string,
    input: StoredCardTokenChargeInput,
  ): Promise<StoredPaymentChargeOutput> {
    return this.postStoredCardTransaction(domToken, {
      ...input,
      metadata: { billing: true, vault: true },
    });
  }

  private async postStoredCardTransaction(
    domToken: string,
    input: StoredCardTokenChargeInput & { metadata: Record<string, unknown> },
  ): Promise<StoredPaymentChargeOutput> {
    const url = `${this.domRealApiUrl}/transactions`;
    const body = {
      cod_external: input.codExternal,
      items: [
        { description: input.description, price: input.amount, quantity: 1 },
      ],
      payment: {
        ...domCashbackPayment(),
        total: input.amount,
        payment_method: 'credit_card',
        credit_card: {
          installments: 1,
          token: input.cardToken,
          upsell: true,
        },
      },
      ...(input.postbackUrl ? { postbackUrl: input.postbackUrl } : {}),
      metadata: JSON.stringify(input.metadata),
    };

    const res = await firstValueFrom(
      this.http.post<unknown>(url, body, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Idempotency-Key': input.idempotencyKey,
        },
      }),
    );
    const response = this.getObject(res.data);
    const root = this.getObject(response?.data) ?? response;
    const paymentId = this.pickString(root, 'id');
    if (!paymentId)
      throw new BadRequestException('Cobrança DOM retornou sem id');

    const liquidCents = this.pickNumber(root, 'liquid_amount');
    return {
      id: paymentId,
      status: this.pickString(root, 'status') ?? 'pending',
      amount: input.amount,
      netAmount: liquidCents == null ? null : liquidCents / 100,
    };
  }

  async changeSubscriptionPlan(
    domToken: string,
    input: { subscriptionId: string; planId: string },
  ): Promise<SubscriptionPlanChangeOutput> {
    const url = `${this.domRealApiUrl}/recurrence/subscriptions/${input.subscriptionId}/change-plan`;
    const res = await firstValueFrom(
      this.http.post<unknown>(
        url,
        { plan_id: input.planId },
        {
          headers: {
            Authorization: `Bearer ${domToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    const response = this.getObject(res.data);
    const root = this.getObject(response?.data) ?? response;
    const newSubscriptionId =
      this.pickString(root, 'id') ??
      this.pickString(root, 'subscription_id') ??
      this.pickString(root, 'subscriber_id');
    if (!newSubscriptionId) {
      throw new BadRequestException(
        'Migração de plano DOM não retornou o novo id da assinatura',
      );
    }

    return {
      subscriptionId: newSubscriptionId,
      planId: input.planId,
      status: this.pickString(root, 'status') ?? undefined,
    };
  }

  async cancelSubscription(domToken: string, id: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.domRealApiUrl}/recurrence/subscriptions/${id}`, {
        headers: { Authorization: `Bearer ${domToken}` },
      }),
    );
  }

  async reactivateSubscription(domToken: string, id: string): Promise<void> {
    await firstValueFrom(
      this.http.put(
        `${this.domRealApiUrl}/recurrence/subscriptions/active/${id}`,
        { reason: 'Solicitado pelo cliente' },
        {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );
  }

  async createSubscriptionFromCheckout(
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
  ): Promise<{ id: string; status?: string; [key: string]: unknown }> {
    const url = `${this.domRealApiUrl}/recurrence/subscriptions`;
    const appUrl =
      process.env.URL_APP ?? 'https://simpay-back.simintermediacoes.com';
    const domCustomerId = await this.getOrCreateDomCustomer(
      domToken,
      input.customer,
    );

    if (!input.card.number) {
      this.logger.warn(
        `[DOM Create Sub] Subscription attempt without card number for customer ${domCustomerId}`,
      );
    }

    const cardToken = input.card.number
      ? await this.createCardToken(domToken, domCustomerId, {
          number: input.card.number,
          cvv: input.card.cvv,
          exp_month: input.card.exp_month,
          exp_year: input.card.exp_year,
          holder_name: input.card.holder_name,
          holder_document: input.card.holder_document,
        })
      : input.card.token;

    const body = {
      plan_id: input.planId,
      payment_method: 'credit_card',
      customer_id: domCustomerId,
      card: {
        token: cardToken,
        installments: 1,
      },
      external_reference: `sub_${Date.now()}_${input.customer.document.slice(-4)}`,
      metadata: null,
      cashback_active: isDomCashbackActive(),
      postbackurl: `${appUrl}/subscription/webhook`,
    };
    this.logger.log(
      `[DOM Create Sub] POST ${url} Body: ${JSON.stringify(body)}`,
    );
    try {
      const res = await firstValueFrom(
        this.http.post<any>(url, body, {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      this.logger.log(`[DOM Create Sub Response] ${JSON.stringify(res.data)}`);
      const data = res.data?.data ?? res.data;
      const obj = this.getObject(data);
      const id = this.pickString(obj, 'id');
      if (!id) {
        this.logger.warn(
          `[DOM] createSubscriptionFromCheckout: resposta sem id: ${JSON.stringify(data)?.slice(0, 400)}`,
        );
        throw new BadRequestException(
          'Não foi possível concluir a assinatura. Verifique os dados do cartão ou tente outra forma de pagamento.',
        );
      }
      return {
        id,
        status: this.pickString(obj, 'status') ?? 'pending',
        ...(obj ?? {}),
      };
    } catch (err) {
      const ax = err as AxiosError<{
        msg?: string;
        message?: string;
        error?: string;
      }>;
      if (ax?.isAxiosError === true && ax.response?.data) {
        const d = ax.response.data as Record<string, unknown>;
        const piece =
          (typeof d.msg === 'string' && d.msg) ||
          (typeof d.message === 'string' && d.message) ||
          (typeof d.error === 'string' && d.error);
        if (piece) {
          throw new BadRequestException(piece);
        }
      }
      if (err instanceof BadRequestException) throw err;
      throw err;
    }
  }

  async createReusableCardToken(
    domToken: string,
    input: Parameters<
      NonNullable<IPaymentGateway['createReusableCardToken']>
    >[1],
  ): Promise<string> {
    const domCustomerId = await this.getOrCreateDomCustomer(
      domToken,
      input.customer,
    );
    return this.createCardToken(domToken, domCustomerId, input.card);
  }

  async recoverSubscriptionCard(
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
  ): Promise<{ paymentId?: string; status?: string }> {
    const snapshot = await this.getSubscriptionBillingSnapshot(
      domToken,
      input.subscriptionId,
    );
    if (!snapshot.customerId)
      throw new BadRequestException('Assinatura sem cliente DOM');
    const cardToken = await this.createCardToken(
      domToken,
      snapshot.customerId,
      input.card,
    );
    await firstValueFrom(
      this.http.post(
        `${this.domRealApiUrl}/recurrence/subscriptions/${input.subscriptionId}`,
        {
          customer_id: snapshot.customerId,
          payment_method: 'credit_card',
          card: { token: cardToken, installments: 1 },
        },
        {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    const charge = await firstValueFrom(
      this.http.put<any>(
        `${this.domRealApiUrl}/recurrence/subscriptions/${input.subscriptionId}/force-charge`,
        {},
        { headers: { Authorization: `Bearer ${domToken}` } },
      ),
    );
    const transaction = (charge.data?.transaction ??
      charge.data?.data?.transaction ??
      {}) as Record<string, unknown>;
    return {
      paymentId: this.pickString(transaction, 'id') ?? undefined,
      status:
        this.pickString(transaction, 'status') ??
        this.pickString(charge.data, 'status') ??
        undefined,
    };
  }

  async listDomTransactions(
    domToken: string,
    input: {
      page: number;
      /** Legacy; DOM documents no page-size parameter, sent only when a caller still passes it. */
      limit?: number;
      status?: string;
      payment_method?: string;
      begin_date?: string;
      end_date?: string;
      /** Which date begin_date/end_date filter on (DOM default: created). */
      type_date?: 'created' | 'updated';
    },
  ): Promise<DomListTransactionsOutput> {
    const url = `${this.domRealApiUrl}/transactions`;

    const params: any = {
      page: input.page,
    };
    if (input.limit !== undefined) params.limit = input.limit;
    if (input.type_date) params.type_date = input.type_date;
    if (input.status) params.status = input.status;
    if (input.payment_method) params.payment_method = input.payment_method;
    if (input.begin_date) params.begin_date = input.begin_date;
    if (input.end_date) {
      params.end_date = input.end_date;
    } else if (input.begin_date) {
      params.end_date = '2026-12-31'; // Safe default for range
    }

    try {
      this.logger.log(
        `[DOM List] GET ${url} Token=${domToken.substring(0, 5)}... Params=${JSON.stringify(params)}`,
      );
      const res = await firstValueFrom(
        this.http.get<any>(url, {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'x-access-token': domToken, // Alguns legados v2 usam esse header
            Accept: 'application/json',
          },
          params,
        }),
      );

      const root = res.data;
      const arr = Array.isArray(root?.data)
        ? root.data
        : Array.isArray(root?.transactions)
          ? root.transactions
          : Array.isArray(root?.rows)
            ? root.rows
            : Array.isArray(root)
              ? root
              : [];
      this.logger.log(`[DOM List] Received ${arr.length} items from ${url}`);

      const transactions: DomTransactionItem[] = arr
        .map((o: any) => {
          const id =
            this.pickString(o, 'id') ?? this.pickString(o, 'order_id') ?? '';

          const amt =
            this.pickNumber(o, 'amount') ??
            this.pickNumber(o, 'total') ??
            this.pickNumber(o, 'valor_bruto') ??
            0;
          let liq =
            this.pickNumber(o, 'liquid_amount') ??
            this.pickNumber(o, 'amountWithoutAllFee') ??
            this.pickNumber(o, 'total_liquido') ??
            this.pickNumber(o, 'amountWithoutFee') ??
            amt;

          // Se amortized_fee_total existe e liquid_amount é 0, calcula
          if (liq === 0 && amt > 0 && (this.pickNumber(o, 'fee') ?? 0) > 0) {
            liq = amt - (this.pickNumber(o, 'fee') ?? 0);
          }

          const customer = this.getObject(o.customer) || o;

          return {
            id,
            order_id:
              this.pickString(o, 'paymentId') ??
              this.pickString(o, 'order_id') ??
              this.pickString(o, 'id') ??
              id,
            cod_external:
              this.pickString(o, 'cod_external') ??
              this.pickString(o, 'external_id'),
            created_at:
              this.pickString(o, 'created_at') ??
              this.pickString(o, 'createdAt') ??
              this.pickString(o, 'create_date') ??
              new Date().toISOString(),
            updated_at:
              this.pickString(o, 'updated_at') ??
              this.pickString(o, 'updatedAt'),
            amount: amt,
            liquid_amount: liq,
            status:
              this.pickString(o, 'status_type') ??
              this.pickString(o, 'status') ??
              'pending',
            payment_method:
              this.pickString(o, 'payment_method') ??
              this.pickString(o, 'method') ??
              this.pickString(o, 'type_payment') ??
              'pix',
            installments: this.pickNumber(o, 'installments') ?? 1,
            customer_name:
              this.pickString(customer, 'name') ??
              this.pickString(customer, 'customer_name') ??
              this.pickString(o, 'client_name'),
            customer_email:
              this.pickString(customer, 'email') ??
              this.pickString(customer, 'customer_email') ??
              this.pickString(o, 'client_email'),
            customer_phone:
              this.pickString(customer, 'mobile_phone') ??
              this.pickString(customer, 'phone') ??
              this.pickString(customer, 'customer_phone') ??
              this.pickString(o, 'client_phone'),
            customer_document:
              this.pickString(customer, 'document') ??
              this.pickString(customer, 'customer_document') ??
              this.pickString(o, 'client_document'),
            product_first:
              this.pickString(o, 'product_first') ||
              (Array.isArray(o?.items) && o.items.length > 0
                ? o.items[0]?.description || o.items[0]?.name || null
                : this.pickString(o, 'description') || null),
            fee_total: amt - liq,
            dom_fee:
              this.pickNumber(o, 'dom_fee') ??
              this.pickNumber(o, 'fee_dom') ??
              0,
          };
        })
        .filter((tx: DomTransactionItem) => tx.id.length > 0);

      return {
        transactions,
        total: this.pickNumber(root, 'total') ?? transactions.length,
        reported_total: this.pickNumber(root, 'total') ?? undefined,
        per_page: this.pickNumber(root, 'per_page') ?? undefined,
        page: this.pickNumber(root, 'page') ?? undefined,
      };
    } catch (error: any) {
      this.logger.error(
        `[DOM Direct Error] status=${error?.response?.status} error=${JSON.stringify(error?.response?.data || error.message)}`,
      );
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
    const domToken = process.env.DOM_TOKEN;

    if (!domToken) {
      throw new Error('DOM Token not configured in Simpay');
    }

    try {
      this.logger.log(
        `[DOM Direct Master] GET ${url} Params: ${JSON.stringify(params)}`,
      );
      const res = await firstValueFrom(
        this.http.get<any>(url, {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'x-access-token': domToken,
            Accept: 'application/json',
          },
          params,
        }),
      );
      return res.data;
    } catch (error: any) {
      this.logger.error(
        `[DOM Direct Master Error] status=${error?.response?.status} error=${JSON.stringify(error?.response?.data || error.message)}`,
      );
      throw error;
    }
  }

  async getDomTransactionDetail(domToken: string, id: string): Promise<any> {
    const url = `${this.domRealApiUrl}/transactions/${id}`;
    try {
      const res = await firstValueFrom(
        this.http.get<any>(url, {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'Cache-Control': 'no-cache',
          },
          timeout: 4_000,
        }),
      );
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

  async createLead(): Promise<{ data: { id: string }; message: string }> {
    return {
      data: { id: 'local-' + Date.now() },
      message: 'Lead created locally',
    };
  }

  async createPixCheckout(
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
  }> {
    const url = `${this.domRealApiUrl}/transactions`;

    const expireAt = new Date();
    expireAt.setHours(expireAt.getHours() + 24);
    const pixExpireFormatted = expireAt
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');

    const body = {
      cod_external: input.codExternal,
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        document: input.customerDocument.replace(/\D/g, ''),
        document_type: input.documentType,
        mobile_phone: input.customerPhone.replace(/\D/g, ''),
      },
      items: {
        description: input.description,
        price: input.amount,
        quantity: 1,
      },
      payment: {
        ...domCashbackPayment(),
        pix: { pix_expire: pixExpireFormatted },
        payment_method: 'pix',
        total: input.amount,
      },
    };

    this.logger.log(`[DOM PIX Checkout] POST ${url} amount=${input.amount}`);

    const res = await firstValueFrom(
      this.http.post<any>(url, body, {
        headers: {
          Authorization: `Bearer ${domToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }),
    );

    const root = res.data?.data ?? res.data;
    const id =
      this.pickString(this.getObject(root), 'id') ??
      this.pickString(this.getObject(root), 'transaction_id');
    if (!id) throw new Error('DOM PIX: resposta sem id de transação');

    const pixContent =
      this.pickString(this.getObject(root), 'pix_content') ??
      this.pickString(this.getObject(root), 'pix_copy_paste') ??
      this.pickString(this.getObject(root), 'pixContent') ??
      null;

    let qrCode =
      this.pickString(this.getObject(root), 'qr_code') ??
      this.pickString(this.getObject(root), 'qr_code_text') ??
      null;

    if (!qrCode && pixContent) {
      try {
        qrCode = await QRCode.toDataURL(pixContent, { width: 256, margin: 2 });
      } catch (e) {
        this.logger.warn(`[DOM PIX Checkout] Falha ao gerar QR code: ${e}`);
      }
    }

    const pixExpire =
      this.pickString(this.getObject(root), 'pix_expire_at') ??
      this.pickString(this.getObject(root), 'pix_expire') ??
      pixExpireFormatted;

    return {
      id,
      status: this.pickString(this.getObject(root), 'status') ?? 'waiting',
      pixContent,
      qrCode,
      pixExpire,
      amount: input.amount,
    };
  }

  getOrCreateCustomer(
    domToken: string,
    customer: Parameters<
      NonNullable<IPaymentGateway['getOrCreateCustomer']>
    >[1],
  ): Promise<string> {
    return this.getOrCreateDomCustomer(domToken, customer);
  }

  private async getOrCreateDomCustomer(
    domToken: string,
    customer: {
      name: string;
      email: string;
      document: string;
      phone: string;
      documentType: 'CPF' | 'CNPJ';
    },
  ): Promise<string> {
    const url = `${this.domRealApiUrl}/customers`;
    const body = {
      name: customer.name,
      email: customer.email,
      document: customer.document.replace(/\D/g, ''),
      document_type: customer.documentType,
      mobile_phone: customer.phone.replace(/\D/g, ''),
      code_external: `cust_${customer.document.replace(/\D/g, '')}`,
    };

    try {
      const res = await firstValueFrom(
        this.http.post<any>(url, body, {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'x-access-token': domToken,
            'Content-Type': 'application/json',
          },
        }),
      );
      const id = res.data?.id ?? res.data?.data?.id;
      if (id) return String(id);
    } catch (err) {
      const ax = err as AxiosError<any>;
      if (ax?.response?.data?.id) {
        return String(ax.response.data.id);
      }
      if (
        typeof ax?.response?.data?.message === 'string' &&
        ax.response.data.message.includes('E-mail existente')
      ) {
        // Se o email já existe mas não retornou o ID no erro, poderíamos tentar buscar por email se houvesse endpoint.
        // No api-dom vemos que ele tenta um GET no ID que vem no erro.
      }
      this.logger.error(
        `[DOM Customer] Error creating customer: status=${ax?.response?.status} data=${JSON.stringify(ax?.response?.data ?? err.message)}`,
      );
      throw err;
    }
    throw new Error('Could not create or find DOM customer');
  }

  private async createCardToken(
    domToken: string,
    domCustomerId: string,
    card: {
      number: string;
      cvv: string;
      exp_month: string;
      exp_year: string;
      holder_name: string;
      holder_document: string;
    },
  ): Promise<string> {
    const url = `${this.domRealApiUrl}/customers/${domCustomerId}/card-token`;
    const body = {
      token: '', // API DOM v3 expects an empty token if we are providing full data, or it's a legacy requirement
      number: card.number.replace(/\s+/g, '').replace(/\D/g, ''),
      cvv: card.cvv.replace(/\s/g, ''),
      exp_month: parseInt(card.exp_month),
      exp_year:
        parseInt(card.exp_year) < 100
          ? parseInt(card.exp_year) + 2000
          : parseInt(card.exp_year),
      holder_name: card.holder_name,
      holder_document: card.holder_document.replace(/\D/g, ''),
    };

    try {
      const res = await firstValueFrom(
        this.http.post<any>(url, body, {
          headers: {
            Authorization: `Bearer ${domToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      const token = res.data?.token ?? res.data?.data?.token;
      if (token) return String(token);
    } catch (err) {
      const ax = err as AxiosError<any>;
      this.logger.error(
        `[DOM Card Token] Error: ${JSON.stringify(ax?.response?.data ?? err.message)}`,
      );
      throw new BadRequestException(
        ax?.response?.data?.message || 'Erro ao processar cartão de crédito.',
      );
    }
    throw new Error('Could not generate card token in DOM');
  }
}
