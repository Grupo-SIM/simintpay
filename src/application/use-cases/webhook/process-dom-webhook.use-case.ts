import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PAYMENT_GATEWAY, type IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { Prisma, PaymentMethod, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaEventsService } from '../../../modules/renovada/events/renovada-events.service';
import { CommunityManagementService } from '../../services/community-management.service';
import { EmailService } from '../../../infrastructure/email/email.service';
import {
  appendInternalTags,
  ORIGEM_MAQUINETA_TAG,
  TENANT_BOSQUE_TAG,
  TENANT_EBOOK_TAG,
  TENANT_RENOVADA_TAG,
} from '../../utils/internal-tags.util';

// ─── Constantes ──────────────────────────────────────────────────────────────

const RENOVADA_USER_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';
const BOSQUE_USER_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
const EBOOK_USER_ID = process.env.EBOOK_ID || 'd4fbf80f-6f13-4bc6-8e15-ebook00000001';

const MACHINE_CONFIG: Record<string, string> = {
  '4AF61W62R': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  '4AF61V34L': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  '4AF61VY6G': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  '4AF61W759': '8b63ba8f-3622-4ecc-ad9a-35389eaeded6',
  'PB1S24C373609': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  'PB1S24C373623': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  'PB1S24C373616': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  'PB1S24C373596': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
};

// ─── Interfaces internas ──────────────────────────────────────────────────────

interface RawDomData {
  id: string;
  created_at?: string;
  amount: number;
  status: string;
  payment_method?: string;
  installments?: string | number;
  serial_number?: string | null;
  /** DOM v3: descrição / primeiro produto (checkout ebook costuma repetir ORD-… aqui) */
  description?: string;
  product_first?: string;
  items?: Array<{ description?: string; name?: string }>;
  external_reference?: string;
  reference_id?: string;
  metadata?: Record<string, unknown>;
  store?: string;
  customer?: {
    name?: string;
    email?: string;
    mobile_phone?: string;
    document?: string;
  };
  liquid_amount?: number | null;
  dom_fee?: number;
  [k: string]: unknown;
}

interface RawDomWebhook {
  event: string;
  signature: string;
  data: RawDomData;
}

// ─── Use-case ────────────────────────────────────────────────────────────────

@Injectable()
export class ProcessDomWebhookUseCase {
  private readonly logger = new Logger(ProcessDomWebhookUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly renovadaEvents?: RenovadaEventsService,
    @Optional() private readonly communities?: CommunityManagementService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() @Inject(PAYMENT_GATEWAY) private readonly paymentGateway?: IPaymentGateway,
  ) { }

  async execute(payload: unknown): Promise<void> {
    const event = this.parsePayload(payload);
    if (!event) {
      this.logger.warn('[DomWebhook] Payload inválido – ignorando');
      return;
    }

    const existingEv = await this.prisma.webhookEvent.findFirst({
      where: { eventId: event.signature },
      select: { id: true },
    });
    if (existingEv) {
      this.logger.log(`[DomWebhook] ${event.signature} já registrado – ignorando`);
      return;
    }

    let wh: { id: string };
    try {
      wh = await this.prisma.webhookEvent.create({
        data: {
          eventId: event.signature,
          source: 'dom-webhook-direct',
          eventType: event.event,
          payload: payload as never,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.log(`[DomWebhook] ${event.signature} corrida duplicada – ignorando`);
        return;
      }
      throw err;
    }

    try {
      const serial = this.detectSerial(event.data);

      if (serial) {
        await this.handleMachineSync(event, serial);
      } else {
        // Verificar se é uma SubscriptionLinkOrder
        const handled = await this.handleSubscriptionLinkPix(event.data.id, event.data.status, wh.id);
        if (!handled) {
          await this.handleTransaction(event);
        }
      }

      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`[DomWebhook] Erro ao processar ${event.signature}: ${msg}`);
      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'FAILED', error: msg, retryCount: { increment: 1 } },
      });
    }
  }

  // ─── Parsing e helpers ────────────────────────────────────────────────────

  private parsePayload(payload: unknown): RawDomWebhook | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.event !== 'string' || typeof p.signature !== 'string') return null;
    const d = p.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    if (typeof (d as Record<string, unknown>).id !== 'string') return null;
    return payload as RawDomWebhook;
  }

  private detectSerial(data: RawDomData): string | null {
    if (data.serial_number && MACHINE_CONFIG[data.serial_number]) {
      return data.serial_number;
    }
    const name = data.customer?.name ?? '';
    const m = name.match(/Terminal:\s*([A-Z0-9]+)/);
    if (m && MACHINE_CONFIG[m[1]]) return m[1];
    return null;
  }

  private mapStatus(s: string): TransactionStatus | null {
    switch (s) {
      case 'paid':
      case 'approved':
      case 'completed':
      case 'revision_paid':
      case 'capture':
        return TransactionStatus.COMPLETED;
      case 'refunded':
      case 'pending_refund':
        return TransactionStatus.REFUNDED;
      case 'chargeback':
        return TransactionStatus.CHARGEBACK;
      case 'failed':
      case 'not_authorized':
        return TransactionStatus.FAILED;
      case 'expired':
        return TransactionStatus.EXPIRED;
      case 'in_mediation':
      case 'dispute_pending':
        return TransactionStatus.IN_MEDIATION;
      case 'pending':
      case 'pending_capture':
        return TransactionStatus.PENDING;
      default:
        return null;
    }
  }

  private calcNet(amountReais: number, liquidAmountReais?: number | null): Prisma.Decimal {
    const factor = parseFloat(process.env.RENOVADA_LIQUIDEZ ?? '0.91');
    const liq = liquidAmountReais != null ? liquidAmountReais : amountReais * factor;
    return new Prisma.Decimal(liq);
  }

  private calcPaymentMethod(method?: string): PaymentMethod {
    return method?.toLowerCase().includes('card')
      ? PaymentMethod.CREDIT_CARD
      : PaymentMethod.PIX;
  }

  private getLiquidezFactor(userId: string): Prisma.Decimal {
    if (userId === RENOVADA_USER_ID) {
      return new Prisma.Decimal(process.env.RENOVADA_LIQUIDEZ ?? '0.91');
    }
    return new Prisma.Decimal(1);
  }

  // ─── Transação regular ────────────────────────────────────────────────────

  private async handleTransaction(event: RawDomWebhook): Promise<void> {
    const { data } = event;
    const nextStatus = this.mapStatus(data.status);
    if (!nextStatus) {
      this.logger.warn(`[DomWebhook] Status desconhecido "${data.status}" – ignorando`);
      return;
    }

    // DOM Pagamentos envia amount e liquid_amount em CENTAVOS → dividir por 100
    const amountDec = new Prisma.Decimal(data.amount / 100);
    const netDec = this.calcNet(
      data.amount / 100,
      data.liquid_amount != null ? data.liquid_amount / 100 : null,
    );
    const totalFee = amountDec.sub(netDec);
    const domFee = new Prisma.Decimal(data.dom_fee ?? 0);
    const platformFee = totalFee.greaterThan(domFee)
      ? totalFee.sub(domFee)
      : new Prisma.Decimal(0);

    const existing = await this.prisma.transaction.findFirst({
      where: { domPaymentId: data.id },
    });

    if (existing) {
      if (existing.status === nextStatus) return;

      const isRenovada = existing.userId === RENOVADA_USER_ID;
      // Renovada: wallet.balance é gross → delta = amountDec (bruto)
      // Outros: wallet.balance = netBalance → delta = netDec
      const delta = isRenovada ? amountDec : amountDec.mul(this.getLiquidezFactor(existing.userId));

      await this.prisma.$transaction(async (p) => {
        await p.transaction.update({
          where: { id: existing.id },
          data: { previousStatus: existing.status, status: nextStatus, updatedAt: new Date() },
        });

        await p.transactionStatusHistory.create({
          data: {
            transactionId: existing.id,
            fromStatus: existing.status,
            toStatus: nextStatus,
            metadata: { reason: `dom-webhook: ${event.event}` },
          },
        });

        let balanceDelta = new Prisma.Decimal(0);
        let lockedDelta = new Prisma.Decimal(0);

        if (
          nextStatus === TransactionStatus.COMPLETED &&
          existing.status !== TransactionStatus.COMPLETED
        ) {
          balanceDelta = delta;
        } else if (
          (nextStatus === TransactionStatus.REFUNDED ||
            nextStatus === TransactionStatus.CHARGEBACK) &&
          existing.status === TransactionStatus.COMPLETED
        ) {
          balanceDelta = delta.neg();
        } else if (
          nextStatus === TransactionStatus.IN_MEDIATION &&
          existing.status === TransactionStatus.COMPLETED
        ) {
          balanceDelta = delta.neg();
          lockedDelta = delta;
        }

        if (balanceDelta.isZero() && lockedDelta.isZero()) return;

        for (let attempt = 0; attempt < 3; attempt++) {
          const wallet = await p.wallet.findUnique({ where: { userId: existing.userId } });
          if (!wallet) break;

          const newBalance = wallet.balance.add(balanceDelta);
          const newLocked = wallet.lockedBalance.add(lockedDelta);

          const result = await p.wallet.updateMany({
            where: { id: wallet.id, version: wallet.version },
            data: { balance: newBalance, lockedBalance: newLocked, version: { increment: 1 } },
          });

          if (result.count > 0) {
            await p.balanceLog.create({
              data: {
                userId: existing.userId,
                action: `DOM_WEBHOOK_${nextStatus}`,
                transactionId: existing.id,
                amount: balanceDelta.abs(),
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                lockedBefore: wallet.lockedBalance,
                lockedAfter: newLocked,
                source: 'DOM_WEBHOOK',
              },
            });
            break;
          }

          if (attempt === 2) {
            throw new Error('Wallet version conflict after 3 retries');
          }
        }
      });

      if (existing.userId === RENOVADA_USER_ID && this.renovadaEvents) {
        this.renovadaEvents.emitTransaction({ ...existing, status: nextStatus });
      }

      if (
        nextStatus === TransactionStatus.COMPLETED &&
        existing.status !== TransactionStatus.COMPLETED
      ) {
        this.logger.log(
          `[DomWebhook][ebook] tx local ${existing.id} → COMPLETED; tentando notificar back-ebook domPaymentId=${data.id}`,
        );
        void this.tryNotifyBackEbookOrderPaidFromDomWebhook(data);
      }
    } else {
      const amountReais = Number(data.amount) / 100;
      const topKeys = Object.keys(data as Record<string, unknown>).slice(0, 18).join(',');
      this.logger.log(
        `[DomWebhook][ebook] sem tx prévia domPaymentId=${data.id} status=${data.status} amount≈${amountReais} ` +
          `hasEmail=${Boolean(data.customer?.email)} BACK_EBOOK_URL=${Boolean(String(process.env.BACK_EBOOK_URL ?? '').trim())} ` +
          `payloadKeys=[${topKeys}]`,
      );
      // Checkout ebook (back-ebook): não cria transação local antes do pagamento → não há domPaymentId na base.
      // Se o payload da DOM trouxer o número do pedido (ORD-AAAA-NNNNNN), notificamos o back-ebook aqui (substitui api-dom).
      const ebookHandled = await this.tryNotifyBackEbookOrderPaidFromDomWebhook(data);
      if (ebookHandled) {
        this.logger.log(
          `[DomWebhook] domPaymentId=${data.id} tratado como ebook: back-ebook notificado (sem tx prévia na machine).`,
        );
        return;
      }

      // Segurança anti-mistura:
      // Se não houver transação pré-existente para o domPaymentId, este webhook não tem
      // contexto confiável de tenant para criar uma nova transação sem risco de atribuir
      // ao tenant errado (ex.: Renovada x Bosque). Nesse caso, ignoramos a criação.
      this.logger.warn(
        `[DomWebhook] domPaymentId=${data.id} sem transação prévia. Ignorando criação para evitar mistura de tenant.`,
      );
      return;

    }
  }

  /**
   * Detecta pedido ebook (ORD-AAAA-NNNNNN) no payload da DOM e chama o back-ebook com token interno.
   * Fluxo oficial pós api-dom: api-machine recebe webhook DOM → confirma pedido no back-ebook.
   */
  private extractEbookOrderNumberFromDomPayload(data: RawDomData): string | null {
    const chunks: string[] = [];
    const push = (v: unknown) => {
      if (typeof v === 'string') chunks.push(v);
    };
    push(data.description);
    push(data.product_first);
    push(data.external_reference);
    push(data.reference_id);
    if (data.metadata && typeof data.metadata === 'object') {
      for (const v of Object.values(data.metadata)) {
        if (typeof v === 'string') push(v);
      }
    }
    if (Array.isArray(data.items)) {
      for (const it of data.items) {
        push(it?.description);
        push(it?.name);
      }
    }
    const blob = chunks.length > 0 ? chunks.join(' ') : '';
    let m = blob.match(/ORD-\d{4}-\d{6}/i);
    if (!m) {
      m = JSON.stringify(data).match(/ORD-\d{4}-\d{6}/i);
    }
    return m ? m[0].toUpperCase() : null;
  }

  /** Sinais de que a cobrança veio do checkout ebook (DOM nem sempre manda ORD no webhook). */
  private domPayloadSuggestsEbookCheckout(data: RawDomData): boolean {
    const d = data as Record<string, unknown>;
    const store = String(d.store ?? '').toLowerCase();
    if (store === 'ebook' || store === 'ebooksim') return true;

    const s = JSON.stringify(data).toLowerCase();
    if (/["']store["']\s*:\s*["']ebook/.test(s) || /["']store["']\s*:\s*["']ebooksim/.test(s)) {
      return true;
    }
    if (s.includes('checkout.jbmidia.com') && (s.includes('ebook') || s.includes('ebooksim'))) {
      return true;
    }
    if (s.includes('back.ebooksim.com')) return true;
    if (/\borderid=/.test(s) && (s.includes('ebook') || s.includes('ebooksim'))) return true;
    if (/\bordernumber=/.test(s) && (s.includes('ebook') || s.includes('ebooksim'))) return true;
    return false;
  }

  /**
   * Monta body para /webhook/payment-confirmation do back-ebook.
   * @param detect — webhook + opcionalmente texto da GET /transactions/:id (para achar ORD- e URLs ebook)
   * @param bodySource — payload cru do webhook (título curto no body; evita mandar JSON gigante ao back-ebook)
   * 1) Preferência: ORD-AAAA-NNNNNN em qualquer campo de `detect`.
   * 2) Senão: checkout ebook inferido + título + email.
   */
  private buildBackEbookNotifyPayload(
    detect: RawDomData,
    bodySource: RawDomData = detect,
  ): {
    orderNumber: string;
    email?: string;
    descriptionLine?: string;
    matchedOrdPattern: boolean;
  } | null {
    const email = bodySource.customer?.email?.trim();
    const ord = this.extractEbookOrderNumberFromDomPayload(detect);
    if (ord) {
      return {
        orderNumber: ord,
        ...(email ? { email } : {}),
        matchedOrdPattern: true,
      };
    }

    const relaxed =
      String(process.env.EBOOK_DOM_WEBHOOK_RELAXED ?? '').toLowerCase() === 'true' ||
      String(process.env.EBOOK_DOM_WEBHOOK_RELAXED ?? '') === '1';

    const suggestsEbook = this.domPayloadSuggestsEbookCheckout(detect);
    const looksEbook = suggestsEbook || relaxed;
    if (!looksEbook) {
      this.logger.warn(
        `[DomWebhook][ebook] domPaymentId=${bodySource.id} sem notificação: sem ORD (webhook+detalhe API) e sem heurística ebook ` +
          `(EBOOK_DOM_WEBHOOK_RELAXED=${relaxed ? '1' : '0'}).`,
      );
      return null;
    }

    if (relaxed && !suggestsEbook) {
      this.logger.warn(
        `[DomWebhook][ebook] EBOOK_DOM_WEBHOOK_RELAXED ativo — notificando por título+email domPaymentId=${bodySource.id}`,
      );
    } else if (suggestsEbook) {
      this.logger.log(
        `[DomWebhook][ebook] domPaymentId=${bodySource.id} heurística ebook positiva → fallback título+email ou ORD só no detalhe`,
      );
    }

    const title = String(bodySource.product_first || bodySource.description || '').trim();
    if (!title) {
      this.logger.warn(
        `[DomWebhook][ebook] domPaymentId=${bodySource.id} inferido ebook mas sem product_first/description`,
      );
      return null;
    }

    if (!email) {
      this.logger.warn(
        `[DomWebhook][ebook] domPaymentId=${bodySource.id} inferido ebook mas sem customer.email`,
      );
      return null;
    }

    const descriptionLine = [
      bodySource.description,
      bodySource.product_first,
      `dom_payment_id:${bodySource.id}`,
    ]
      .filter((x) => typeof x === 'string' && x.trim())
      .join(' | ');

    return {
      orderNumber: title,
      email,
      descriptionLine: descriptionLine || undefined,
      matchedOrdPattern: false,
    };
  }

  /** DOM v3: o webhook é pobre; GET /transactions/:id costuma trazer ORD- na descrição/checkout. */
  private async fetchDomTransactionDetailJson(domPaymentId: string): Promise<string | null> {
    if (!this.paymentGateway) return null;
    const domToken = String(process.env.DOM_TOKEN ?? process.env.API_DOM_MASTER_KEY ?? '').trim();
    if (!domToken) return null;
    try {
      const detail = await this.paymentGateway.getDomTransactionDetail(domToken, domPaymentId);
      if (detail == null) return null;
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
    } catch (e) {
      this.logger.warn(
        `[DomWebhook][ebook] GET DOM transactions/${domPaymentId} falhou: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private async tryNotifyBackEbookOrderPaidFromDomWebhook(data: RawDomData): Promise<boolean> {
    const st = String(data.status ?? '').toLowerCase();
    if (!['paid', 'approved', 'completed', 'revision_paid', 'capture'].includes(st)) {
      this.logger.log(
        `[DomWebhook][ebook] domPaymentId=${data.id} skip_notify reason=status_not_final status=${data.status}`,
      );
      return false;
    }

    const bodySource = data;
    let detect: RawDomData = data;
    const wantEnrich = Boolean(String(process.env.BACK_EBOOK_URL ?? '').trim());
    if (wantEnrich) {
      const blob = await this.fetchDomTransactionDetailJson(data.id);
      if (blob) {
        const ordInDetail = /ORD-\d{4}-\d{6}/i.test(blob);
        const ebookHint =
          blob.toLowerCase().includes('ebook') ||
          blob.includes('jbmidia.com') ||
          blob.includes('ebooksim');
        this.logger.log(
          `[DomWebhook][ebook] detalhe API DOM domPaymentId=${data.id} jsonBytes=${blob.length} ordInDetail=${ordInDetail} ebookUrlHint=${ebookHint}`,
        );
        detect = {
          ...data,
          description: `${String(data.description ?? '')} ${blob.slice(0, 20000)}`.trim(),
        };
      } else {
        this.logger.log(
          `[DomWebhook][ebook] sem detalhe API DOM para ${data.id} (token/gateway indisponível ou tx não encontrada)`,
        );
      }
    }

    const payload = this.buildBackEbookNotifyPayload(detect, bodySource);
    if (!payload) {
      return false;
    }

    const { orderNumber, email, descriptionLine, matchedOrdPattern } = payload;

    const backEbookUrl = String(process.env.BACK_EBOOK_URL ?? '').replace(/\/+$/, '');
    const token =
      process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '';
    if (!backEbookUrl || !token) {
      this.logger.warn(
        `[DomWebhook][ebook] domPaymentId=${data.id} orderRef=${orderNumber} bloqueado: ` +
          `BACK_EBOOK_URL=${backEbookUrl ? 'ok' : 'MISSING'} tokenConfigured=${Boolean(token)}`,
      );
      return true;
    }

    const endpoint = `${backEbookUrl}/webhook/payment-confirmation`;
    this.logger.log(
      `[DomWebhook][ebook] POST ${endpoint} domPaymentId=${data.id} orderRef=${orderNumber} ordPattern=${matchedOrdPattern} hasEmail=${Boolean(email)} tokenLen=${token.length}`,
    );
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({
          orderNumber,
          status: 'COMPLETED',
          store: 'ebook',
          ...(email ? { email } : {}),
          ...(descriptionLine ? { description: descriptionLine } : {}),
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.error(
          `[DomWebhook] back-ebook ${orderNumber} respondeu ${res.status}: ${text.slice(0, 600)}`,
        );
        return true;
      }
      this.logger.log(
        `[DomWebhook][ebook] back-ebook HTTP ${res.status} OK ref=${orderNumber} domPaymentId=${data.id}`,
      );

      // Extrair ownerCpf da resposta do back-ebook para vincular a transaction ao autor correto
      let ownerCpf: string | null = null;
      try {
        const parsed = JSON.parse(text);
        ownerCpf = typeof parsed?.ownerCpf === 'string' ? parsed.ownerCpf : null;
      } catch { /* resposta não-JSON, ignorar */ }

      void this.upsertEbookTransaction(data, orderNumber, ownerCpf);

      return true;
    } catch (e) {
      this.logger.error(
        `[DomWebhook][ebook] fetch back-ebook falhou orderRef=${orderNumber} domPaymentId=${data.id}: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
      return true;
    }
  }

  /** Cria ou garante que existe uma Transaction local para o pedido ebook,
   *  permitindo que /admin/plataformas/ebook/transacoes e /internal/ebook/finance/* funcionem. */
  private async upsertEbookTransaction(data: RawDomData, orderNumber: string, ownerCpf: string | null): Promise<void> {
    try {
      const existing = await this.prisma.transaction.findFirst({
        where: { domPaymentId: data.id },
      });
      if (existing) {
        this.logger.log(`[DomWebhook][ebook] tx local já existe id=${existing.id} para domPaymentId=${data.id}`);
        return;
      }

      // Busca qualquer transação existente para esse orderNumber (PENDING, BACKFILL ou qualquer outro estado)
      const pendingDomId = `EBOOK_PENDING_${orderNumber}`;
      const backfillDomId = `EBOOK_BACKFILL_${orderNumber}`;
      const pendingTx = await this.prisma.transaction.findFirst({
        where: {
          OR: [
            { domPaymentId: pendingDomId },
            { domPaymentId: backfillDomId },
            { description: { contains: orderNumber } },
          ],
        },
      });
      if (pendingTx) {
        this.logger.log(`[DomWebhook][ebook] atualizando tx PENDING → COMPLETED id=${pendingTx.id}`);
        const amountDec = new Prisma.Decimal(data.amount / 100);
        const netDec = this.calcNet(data.amount / 100, data.liquid_amount != null ? data.liquid_amount / 100 : null);
        const custName = (data as any).customer_name || data.customer?.name || null;
        const custEmail = (data as any).customer_email || data.customer?.email || null;
        const custDoc = ((data as any).customer_document || data.customer?.document || '').replace(/\D/g, '') || null;
        await this.prisma.$transaction(async (p) => {
          await p.transaction.update({
            where: { id: pendingTx.id },
            data: {
              status: 'COMPLETED',
              domPaymentId: data.id,
              amount: amountDec,
              netAmount: netDec,
              totalFee: amountDec.sub(netDec),
              domFee: new Prisma.Decimal(data.dom_fee ?? 0),
              customerName: custName,
              customerEmail: custEmail,
              customerDocument: custDoc,
              updatedAt: new Date(),
            },
          });
          await p.wallet.update({
            where: { userId: pendingTx.userId },
            data: { balance: { increment: netDec }, updatedAt: new Date() },
          });
        });
        return;
      }

      // Resolve o userId do autor pelo CPF, se disponível
      let ebookUserId: string | null = null;
      if (ownerCpf) {
        const cpfClean = ownerCpf.replace(/\D/g, '');
        const cpfFormatted = cpfClean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        const author = await this.prisma.user.findFirst({
          where: { cpf: { in: [cpfClean, cpfFormatted] } },
          select: { id: true },
        });
        ebookUserId = author?.id ?? null;
        if (ebookUserId) {
          this.logger.log(`[DomWebhook][ebook] CPF ${cpfClean} → userId=${ebookUserId}`);
        } else {
          this.logger.log(`[DomWebhook][ebook] CPF ${cpfClean} sem conta na api-machine — usando conta genérica ebook`);
        }
      }

      // Autor sem conta ainda: usar conta genérica ebook como placeholder
      if (!ebookUserId) {
        ebookUserId = EBOOK_USER_ID;
        await this.prisma.user.upsert({
          where: { id: ebookUserId },
          update: {},
          create: {
            id: ebookUserId,
            name: process.env.EBOOK_NAME || 'Ebook',
            email: process.env.EBOOK_EMAIL || 'contato@ebook.com.br',
            password: 'migrated',
            role: 'USER',
            domToken: null,
          },
        });
      }

      await this.prisma.wallet.upsert({
        where: { userId: ebookUserId },
        update: {},
        create: { userId: ebookUserId, balance: 0, lockedBalance: 0 },
      });

      const amountDec = new Prisma.Decimal(data.amount / 100);
      const netDec = this.calcNet(
        data.amount / 100,
        data.liquid_amount != null ? data.liquid_amount / 100 : null,
      );

      // CPF do dono na description garante reconhecimento quando ele criar conta no simpay
      const cpfTag = ownerCpf ? ` [CPF_DONO:${ownerCpf.replace(/\D/g, '')}]` : '';
      const description = appendInternalTags(orderNumber, [TENANT_EBOOK_TAG]) + cpfTag;

      await this.prisma.$transaction(async (p) => {
        const tx = await p.transaction.create({
          data: {
            userId: ebookUserId,
            domPaymentId: data.id,
            amount: amountDec,
            netAmount: netDec,
            totalFee: amountDec.sub(netDec),
            domFee: new Prisma.Decimal(data.dom_fee ?? 0),
            status: TransactionStatus.COMPLETED,
            paymentMethod: this.calcPaymentMethod(data.payment_method),
            description,
            installments: Number(data.installments ?? 1),
            customerName: (data as any).customer_name || data.customer?.name || '',
            customerEmail: (data as any).customer_email || data.customer?.email || '',
            customerDocument: (((data as any).customer_document || data.customer?.document || '') as string).replace(/\D/g, ''),
            customerPhone: (data as any).customer_phone || data.customer?.mobile_phone || '',
            createdAt: data.created_at ? new Date(data.created_at) : new Date(),
          },
        });

        await p.transactionStatusHistory.create({
          data: {
            transactionId: tx.id,
            fromStatus: TransactionStatus.DRAFT,
            toStatus: TransactionStatus.COMPLETED,
            metadata: { reason: 'ebook-dom-webhook', orderNumber },
          },
        });

        // Atualizar saldo da wallet do usuário ebook
        for (let attempt = 0; attempt < 3; attempt++) {
          const wallet = await p.wallet.findUnique({ where: { userId: ebookUserId } });
          if (!wallet) break;
          const newBalance = wallet.balance.add(netDec);
          const updated = await p.wallet.updateMany({
            where: { id: wallet.id, version: wallet.version },
            data: { balance: newBalance, version: { increment: 1 } },
          });
          if (updated.count > 0) {
            await p.balanceLog.create({
              data: {
                userId: ebookUserId,
                action: 'DOM_WEBHOOK_COMPLETED',
                transactionId: tx.id,
                amount: netDec,
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                lockedBefore: wallet.lockedBalance,
                lockedAfter: wallet.lockedBalance,
                source: 'EBOOK_WEBHOOK',
                description: `Pedido ebook: ${orderNumber}`,
              },
            });
            break;
          }
          if (attempt === 2) throw new Error('Wallet version conflict after 3 retries');
        }

        return tx;
      });

      this.logger.log(`[DomWebhook][ebook] Transaction local criada para domPaymentId=${data.id} orderNumber=${orderNumber}`);
    } catch (e) {
      this.logger.error(
        `[DomWebhook][ebook] Falha ao criar transaction local domPaymentId=${data.id}: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ─── Máquinetas físicas ───────────────────────────────────────────────────

  private async handleMachineSync(event: RawDomWebhook, serial: string): Promise<void> {
    const { data } = event;

    if (data.status !== 'paid') {
      this.logger.log(`[DomWebhook] Máquineta ${serial} status=${data.status} – sem sincronização`);
      return;
    }

    const userId = MACHINE_CONFIG[serial];

    const alreadySynced = await this.prisma.transaction.findFirst({
      where: { domPaymentId: data.id, userId },
    });
    if (alreadySynced) {
      this.logger.log(`[DomWebhook] Máquineta ${serial} tx ${data.id} já sincronizada`);
      return;
    }

    const amountDec = new Prisma.Decimal(data.amount / 100);
    const netDec = this.calcNet(
      data.amount / 100,
      data.liquid_amount != null ? data.liquid_amount / 100 : null,
    );

    const tx = await this.prisma.$transaction(async (p) => {
      const newTx = await p.transaction.create({
        data: {
          userId,
          domPaymentId: data.id,
          amount: amountDec,
          netAmount: netDec,
          totalFee: amountDec.sub(netDec),
          status: TransactionStatus.COMPLETED,
          paymentMethod: this.calcPaymentMethod(data.payment_method),
          description: appendInternalTags(
            `Sincronização Automática - Terminal: ${serial}`,
            [
              ...(userId === RENOVADA_USER_ID ? [TENANT_RENOVADA_TAG] : []),
              ...(userId === BOSQUE_USER_ID ? [TENANT_BOSQUE_TAG] : []),
              ORIGEM_MAQUINETA_TAG,
            ],
          ),
          installments: Number(data.installments ?? 1),
          customerName: data.customer?.name ?? 'Cliente POS',
          customerEmail: data.customer?.email ?? '',
          customerDocument: data.customer?.document ?? '',
          customerPhone: data.customer?.mobile_phone ?? '',
          createdAt: data.created_at ? new Date(data.created_at) : new Date(),
        },
      });

      await p.transactionStatusHistory.create({
        data: {
          transactionId: newTx.id,
          fromStatus: TransactionStatus.DRAFT,
          toStatus: TransactionStatus.COMPLETED,
          metadata: { reason: 'machine-sync-webhook', serial },
        },
      });

      for (let attempt = 0; attempt < 3; attempt++) {
        const wallet = await p.wallet.findUnique({ where: { userId } });
        if (!wallet) break;

        const newBalance = wallet.balance.add(amountDec);

        const result = await p.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: { balance: newBalance, version: { increment: 1 } },
        });

        if (result.count > 0) {
          await p.balanceLog.create({
            data: {
              userId,
              action: 'MACHINE_SYNC',
              transactionId: newTx.id,
              amount: amountDec,
              balanceBefore: wallet.balance,
              balanceAfter: newBalance,
              lockedBefore: wallet.lockedBalance,
              lockedAfter: wallet.lockedBalance,
              source: 'MACHINE_SYNC',
              description: `Terminal: ${serial}`,
            },
          });
          break;
        }

        if (attempt === 2) {
          throw new Error('Wallet version conflict after 3 retries');
        }
      }

      return newTx;
    });

    if (userId === RENOVADA_USER_ID && this.renovadaEvents) {
      this.renovadaEvents.emitTransaction(tx);
    }
    this.logger.log(`[DomWebhook] Máquineta sincronizada: ${serial} → tx ${tx.id}`);
  }

  // ─── SubscriptionLinkOrder ────────────────────────────────────────────────

  private async handleSubscriptionLinkPix(
    domPixPaymentId: string,
    domStatus: string,
    webhookEventDbId: string,
  ): Promise<boolean> {
    const order = await this.prisma.subscriptionLinkOrder.findFirst({
      where: { domPixPaymentId },
      include: { subscriptionLink: true },
    });

    if (!order) return false;

    this.logger.log(
      `[DomWebhook] SubscriptionLinkOrder ${order.id} encontrada para domPixPaymentId=${domPixPaymentId}, status=${domStatus}`,
    );

    if (domStatus !== 'paid') {
      const statusMap: Record<string, string> = {
        expired: 'expired',
        failed: 'failed',
        refunded: 'refunded',
      };
      const newStatus = statusMap[domStatus];
      if (newStatus && order.status === 'pending') {
        await this.prisma.subscriptionLinkOrder.update({
          where: { id: order.id },
          data: { status: newStatus },
        });
      }
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventDbId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return true;
    }

    // Já processado
    if (order.status === 'paid') {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventDbId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return true;
    }

    // Marcar como pago
    await this.prisma.subscriptionLinkOrder.update({
      where: { id: order.id },
      data: { status: 'paid' },
    });

    // Ativar acesso à comunidade
    if (this.communities) {
      try {
        const binding = await this.prisma.communityLinkBinding.findFirst({
          where: { subscriptionLinkId: order.subscriptionLinkId },
        });

        if (binding) {
          await this.communities.activateOrRenewCommunityAccess({
            communityId: binding.communityId,
            userId: order.userId,
            frequencyType: order.subscriptionLink.frequencyType,
            paymentMethod: 'PIX',
            amountCharged: Number(order.amountCharged),
            subscriptionLinkOrderId: order.id,
          });
          this.logger.log(`[DomWebhook] Acesso à comunidade ativado para order ${order.id}`);
        }
      } catch (err: unknown) {
        this.logger.error(
          `[DomWebhook] Erro ao ativar comunidade para order ${order.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }

    // Enviar email de acesso
    if (this.emailService) {
      try {
        await this.emailService.sendSubscriptionAccess({
          to: order.customerEmail,
          customerName: order.customerName,
          linkName: order.subscriptionLink.name,
          redirectUrl: order.subscriptionLink.redirectUrl ?? null,
          orderId: order.id,
        });
        this.logger.log(`[DomWebhook] Email de acesso enviado para ${order.customerEmail}`);
      } catch (err: unknown) {
        this.logger.error(
          `[DomWebhook] Erro ao enviar email para order ${order.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }

    // Não atualizar webhookEventDbId aqui — o chamador (execute) fará isso
    return true;
  }
}
