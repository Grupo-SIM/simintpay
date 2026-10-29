import { getPlatformIntegrationValue } from '../../modules/platform-integrations/platform-integrations.store';
import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  NotImplementedException,
  BadRequestException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';
import * as QRCode from 'qrcode';
import {
  IPaymentGateway,
  DomPaymentLinkOutput,
  DomPlanOutput,
  DomSubscriptionOutput,
  DomRequestWithdrawOutput,
  DomListTransactionsOutput,
  StoredPaymentChargeOutput,
  SubscriptionBillingSnapshot,
  SubscriptionPlanChangeOutput,
} from '../../core/services/payment-gateway.interface';
import {
  FRENDZ_API_BASE_URL,
  getFrendzApiToken,
} from '../../modules/frendz/frendz.config';
import { FrendzProductService } from './frendz-product.service';

/**
 * ──────────────────────────────────────────────────────────────────────────
 * FrendzClient — implementação de IPaymentGateway para a adquirente Frendz.
 *
 * ESCOPO v1: PIX ponta a ponta (criar cobrança, consultar, saldo, saque).
 * Métodos de cartão, planos/assinaturas e payment-links lançam
 * NotImplementedException de propósito — assim uma loja roteada para a Frendz
 * que tente uma operação ainda não suportada recebe um erro EXPLÍCITO em vez
 * de um comportamento silenciosamente errado. Esses métodos entram na fase 2.
 *
 * Diferenças-chave vs. DOM, encapsuladas aqui:
 *  - Auth: `api_token` em query string (não Bearer header).
 *  - Cobrança exige `offer_hash` → resolvido via FrendzProductService.
 *  - Valores em centavos (igual DOM).
 *  - Confirmação de pagamento via postback (webhook) — ver frendz-webhook.*
 * ──────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class FrendzClient implements IPaymentGateway {
  private readonly logger = new Logger(FrendzClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly products: FrendzProductService,
  ) {}

  // ─── helpers ────────────────────────────────────────────────────────────

  /**
   * O contrato da interface entrega um `domToken` em quase todo método. Para a
   * Frendz esse parâmetro carrega, na prática, o `api_token` da conta Frendz.
   * Quando vier vazio (ex.: chamada que não resolveu token), caímos no token
   * global de env — nunca hard-coded.
   */
  private resolveToken(maybeToken?: string | null): string {
    const token =
      maybeToken && maybeToken.length > 0 ? maybeToken : getFrendzApiToken();
    if (!token) {
      throw new BadRequestException(
        'Frendz: api_token não configurado (defina FRENDZ_API_TOKEN ou {SLUG}_FRENDZ_TOKEN).',
      );
    }
    return token;
  }

  private getObject(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  }

  private pickString(
    obj: Record<string, unknown> | null,
    key: string,
  ): string | null {
    if (!obj) return null;
    const v = obj[key];
    if (typeof v === 'string') return v.length ? v : null;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return null;
  }

  private errMsg(err: unknown): string {
    const ax = err as AxiosError<any>;
    return (
      ax?.response?.data?.message ??
      ax?.response?.data?.error ??
      (err as Error)?.message ??
      'erro desconhecido'
    );
  }

  // ─── PIX (v1, implementado) ───────────────────────────────────────────────

  /**
   * Cria uma cobrança PIX na Frendz (`POST /transactions`, payment_method=pix).
   * Devolve o mesmo formato que o ApiDomClient, para os use-cases não notarem
   * diferença de adquirente.
   */
  async createPixCheckout(
    apiToken: string,
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
    const token = this.resolveToken(apiToken);
    const offerHash = await this.products.resolveOfferHash(token);

    const body = {
      amount: input.amount, // centavos
      offer_hash: offerHash,
      payment_method: 'pix',
      // postback_url diz à Frendz para onde enviar a confirmação de pagamento.
      // Definido por env para apontar ao endpoint público desta API.
      ...((getPlatformIntegrationValue('FRENDZ', 'WEBHOOK_URL') ?? undefined)
        ? {
            postback_url:
              getPlatformIntegrationValue('FRENDZ', 'WEBHOOK_URL') ?? undefined,
          }
        : {}),
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        phone_number: input.customerPhone.replace(/\D/g, ''),
        document: input.customerDocument.replace(/\D/g, ''),
      },
      // Rastreabilidade: nosso id externo viaja junto, se a Frendz ecoar.
      external_reference: input.codExternal,
    };

    const url = `${FRENDZ_API_BASE_URL}/transactions`;
    this.logger.log(`[Frendz PIX] POST ${url} amount=${input.amount}`);

    let res;
    try {
      res = await firstValueFrom(
        this.http.post<any>(url, body, {
          params: { api_token: token },
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }),
      );
    } catch (err) {
      this.logger.error(
        `[Frendz PIX] falha ao criar transação: ${this.errMsg(err)}`,
      );
      throw new BadRequestException(`Frendz: ${this.errMsg(err)}`);
    }

    const root = res.data?.data ?? res.data;
    const obj = this.getObject(root);

    // hash é o identificador da transação na Frendz.
    const id =
      this.pickString(obj, 'hash') ??
      this.pickString(obj, 'id') ??
      this.pickString(obj, 'transaction_hash');
    if (!id)
      throw new BadRequestException('Frendz: resposta sem hash de transação');

    // Campos PIX podem vir na raiz ou aninhados em `pix`.
    const pixObj = this.getObject(obj?.pix) ?? obj;
    const pixContent =
      this.pickString(pixObj, 'pix_code') ??
      this.pickString(pixObj, 'qr_code') ??
      this.pickString(pixObj, 'emv') ??
      this.pickString(pixObj, 'copy_paste') ??
      null;

    let qrCode =
      this.pickString(pixObj, 'qr_code_image') ??
      this.pickString(pixObj, 'qr_code_url') ??
      null;

    // A Frendz devolve o "copia-e-cola"; geramos a imagem do QR localmente
    // (mesmo comportamento do ApiDomClient).
    if (!qrCode && pixContent) {
      try {
        qrCode = await QRCode.toDataURL(pixContent, { width: 256, margin: 2 });
      } catch (e) {
        this.logger.warn(`[Frendz PIX] falha ao gerar QR: ${e}`);
      }
    }

    const pixExpire =
      this.pickString(obj, 'expires_at') ??
      this.pickString(pixObj, 'expires_at') ??
      this.pickString(pixObj, 'expiration_date') ??
      null;

    return {
      id,
      status: this.pickString(obj, 'status') ?? 'pending',
      pixContent,
      qrCode,
      pixExpire,
      amount: input.amount,
    };
  }

  /** Detalhe bruto de uma transação (`GET /transactions/{hash}`). */
  async getDomTransactionDetail(apiToken: string, hash: string): Promise<any> {
    const token = this.resolveToken(apiToken);
    try {
      const res = await firstValueFrom(
        this.http.get<any>(`${FRENDZ_API_BASE_URL}/transactions/${hash}`, {
          params: { api_token: token },
        }),
      );
      return res.data?.data ?? res.data;
    } catch (err) {
      this.logger.error(
        `[Frendz] getTransactionDetail falhou: ${this.errMsg(err)}`,
      );
      throw new BadRequestException(`Frendz: ${this.errMsg(err)}`);
    }
  }

  /** Saldo da conta (`GET /balance`). Mapeado para o "summary" da interface. */
  async getDomSummary(apiToken: string): Promise<any> {
    const token = this.resolveToken(apiToken);
    const res = await firstValueFrom(
      this.http.get<any>(`${FRENDZ_API_BASE_URL}/balance`, {
        params: { api_token: token },
      }),
    );
    return res.data?.data ?? res.data;
  }

  /** Solicita saque (`POST /transfers`). Valor em centavos. */
  async requestWithdraw(
    apiToken: string,
    input: { amount: number; pixKey: string },
  ): Promise<DomRequestWithdrawOutput> {
    const token = this.resolveToken(apiToken);
    try {
      const res = await firstValueFrom(
        this.http.post<any>(
          `${FRENDZ_API_BASE_URL}/transfers`,
          { amount: input.amount },
          {
            params: { api_token: token },
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        ),
      );
      const root = res.data?.data ?? res.data;
      const obj = this.getObject(root);
      const requestId =
        this.pickString(obj, 'hash') ??
        this.pickString(obj, 'transfer_hash') ??
        this.pickString(obj, 'id') ??
        '';
      return {
        requestId,
        fee: 0,
        netAmount: input.amount,
        totalAmount: input.amount,
        message: 'Saque solicitado na Frendz',
      };
    } catch (err) {
      this.logger.error(`[Frendz] requestWithdraw falhou: ${this.errMsg(err)}`);
      throw new BadRequestException(`Frendz: ${this.errMsg(err)}`);
    }
  }

  // ─── Fase 2 / não suportado nesta versão ──────────────────────────────────
  // Lançam NotImplementedException de propósito: uma loja Frendz que tente
  // estas operações hoje recebe erro claro. Implementar conforme a doc Frendz.

  private notYet(method: string): never {
    throw new NotImplementedException(
      `Frendz: operação "${method}" ainda não suportada (PIX-only na v1).`,
    );
  }

  createPaymentLink(): Promise<DomPaymentLinkOutput> {
    return this.notYet('createPaymentLink');
  }
  updatePaymentLink(): Promise<DomPaymentLinkOutput> {
    return this.notYet('updatePaymentLink');
  }
  deletePaymentLink(): Promise<void> {
    return this.notYet('deletePaymentLink');
  }
  chargePixForLink(): Promise<{
    id: string;
    status: string;
    pixContent: string | null;
    qrCode: string | null;
    pixExpire: string | null;
    amount: number;
  }> {
    return this.notYet('chargePixForLink');
  }
  chargeBoletoForLink(): Promise<{
    id: string;
    status: string;
    boletoUrl: string | null;
    barcode: string | null;
    digitableLine: string | null;
    dueDate: string | null;
    amount: number;
  }> {
    return this.notYet('chargeBoletoForLink');
  }
  chargePaymentLink(): Promise<{
    id: string;
    status?: string;
    pixContent?: string | null;
  }> {
    return this.notYet('chargePaymentLink');
  }
  createPlan(): Promise<DomPlanOutput> {
    return this.notYet('createPlan');
  }
  listPlans(): Promise<DomPlanOutput[]> {
    return this.notYet('listPlans');
  }
  deletePlan(): Promise<void> {
    return this.notYet('deletePlan');
  }
  listSubscriptions(): Promise<{
    items: DomSubscriptionOutput[];
    total?: number;
  }> {
    return this.notYet('listSubscriptions');
  }
  getSubscription(): Promise<unknown> {
    return this.notYet('getSubscription');
  }
  getSubscriptionBillingSnapshot(): Promise<SubscriptionBillingSnapshot> {
    return this.notYet('getSubscriptionBillingSnapshot');
  }
  chargeSubscriptionPaymentMethod(): Promise<StoredPaymentChargeOutput> {
    return this.notYet('chargeSubscriptionPaymentMethod');
  }
  changeSubscriptionPlan(
    _t: string,
    _input: { subscriptionId: string; planId: string },
  ): Promise<SubscriptionPlanChangeOutput> {
    void _t;
    void _input;
    return this.notYet('changeSubscriptionPlan');
  }
  cancelSubscription(): Promise<void> {
    return this.notYet('cancelSubscription');
  }
  reactivateSubscription(): Promise<void> {
    return this.notYet('reactivateSubscription');
  }
  listDomTransactions(): Promise<DomListTransactionsOutput> {
    return this.notYet('listDomTransactions');
  }
  listAllTransactionsDirectlyFromDom(): Promise<any> {
    return this.notYet('listAllTransactionsDirectlyFromDom');
  }
  createSubscriptionFromCheckout(): Promise<{
    id: string;
    status?: string;
    [key: string]: unknown;
  }> {
    return this.notYet('createSubscriptionFromCheckout');
  }
  createLead(): Promise<{ data: { id: string }; message: string }> {
    return this.notYet('createLead');
  }
}
