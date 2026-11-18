import { alertUnresolvedWebhook } from '../../../modules/billing-core/webhook-offer-resolution';
import { quoteCardOwnerShare } from '../../../modules/financial-policy/platform-fee-schedule';
import { settleEbookPayment } from '../../../modules/platform-core/ebook-settlement';
import { applyWalletEntry } from '../../../modules/wallet-ledger/wallet-ledger';
import {
  ebookOrderCreditMetadata,
  fundEbookCommission,
} from '../../../modules/platform-core/ebook-commission-funding';
import {
  loadChargePolicy,
  quoteReportedPos,
} from '../../../modules/financial-policy/financial-charge';
import {
  isPhysicalDebit,
  resolveDomFeeReais,
} from '../../helpers/dom-fee-estimate.helper';
import { markChargeSettled } from '../../../modules/billing-core/charge-settlement';
import {
  creditedSettlementAmount,
  bindLinkPayment,
  linkChargeReference,
  settleFinalNet,
} from '../../../modules/platform-core/link-settlement';
import { PlatformEventsService } from '../../../modules/platform-core/platform-events.service';
import { EBOOK_PENDING_PREFIX } from '../../../modules/platform-core/ebook-pending-adoption';
import { platformTaxaTagForTransaction } from '../../helpers/dom-fee-estimate.helper';
import {
  transactionPlatformTag,
  transactionPlatformTagData,
} from '../../../modules/platform-core/transaction-platform';
import {
  getPlatformOwnerId,
  registeredPlatformTags,
} from '../../../modules/module.registry';
import { getPlatformIntegrationValue } from '../../../modules/platform-integrations/platform-integrations.store';
import {
  QUEUE_SERVICE,
  type IQueueService,
} from '../../../core/services/queue.interface';
import { QueueNames } from '../../../infrastructure/queue/queue-names';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  PAYMENT_GATEWAY,
  type IPaymentGateway,
} from '../../../core/services/payment-gateway.interface';
import {
  Prisma,
  PaymentMethod,
  Transaction,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaEventsService } from '../../../modules/renovada/events/renovada-events.service';
import { EmailService } from '../../../infrastructure/email/email.service';
import { CheckoutEventsService } from '../../services/checkout-events.service';
import { VoucherService } from '../voucher/voucher.service';
import { AffiliateCommissionService } from '../../services/affiliate-commission.service';
import {
  appendInternalTags,
  ORIGEM_MAQUINETA_TAG,
  TENANT_EBOOK_TAG,
} from '../../utils/internal-tags.util';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import {
  PLATFORM_TAXA_DEFAULTS,
  LEGACY_DOM_CASHBACK_REAIS,
} from '../../../modules/platform-taxas/platform-taxas.keys';
import { calculateSellerNetValue } from '../../helpers/transaction-fee.helper';
import { getEbookTaxaServico } from '../../../modules/ebooksim/ebooksim.config';
import { calculateMaquinetaFees } from '../../helpers/maquineta-fee.helper';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { notifyZeroGrauPaymentStatus } from '../../../modules/zero-grau/services/zero-grau-webhook-notifier';

// ─── Constantes ──────────────────────────────────────────────────────────────

function machineOwners(): Record<string, string> {
  return Object.fromEntries(
    registeredPlatformTags().flatMap((tag) => {
      const owner = getPlatformOwnerId(tag);
      return owner
        ? (getPlatformIntegrationValue(tag, 'MACHINE_SERIALS') ?? '')
            .split(',')
            .filter(Boolean)
            .map((serial) => [serial.trim(), owner])
        : [];
    }),
  );
}

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
  cod_external?: string;
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
  /** Bandeira do cartão — no POS é o que distingue débito de crédito. */
  card_brand?: string | null;
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
    private readonly voucherService: VoucherService,
    private readonly affiliateCommission: AffiliateCommissionService,
    @Optional() private readonly renovadaEvents?: RenovadaEventsService,
    @Optional() private readonly emailService?: EmailService,
    @Optional()
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway?: IPaymentGateway,
    @Optional() private readonly checkoutEvents?: CheckoutEventsService,
    @Optional() private readonly storage?: StorageService,
    @Optional() @Inject(QUEUE_SERVICE) private readonly queue?: IQueueService,
    @Optional() private readonly platformEvents?: PlatformEventsService,
  ) {}

  async execute(payload: unknown): Promise<void> {
    const event = this.parsePayload(payload);
    if (!event) {
      this.logger.warn('[DomWebhook] Payload inválido – ignorando');
      return;
    }

    const existingEv = await this.prisma.webhookEvent.findFirst({
      where: { eventId: event.signature },
      select: { id: true, status: true },
    });
    if (existingEv?.status === 'PROCESSED') {
      this.logger.log(
        `[DomWebhook] ${event.signature} já registrado – ignorando`,
      );
      return;
    }

    let wh: { id: string };
    try {
      wh =
        existingEv ??
        (await this.prisma.webhookEvent.create({
          data: {
            eventId: event.signature,
            source: 'dom-webhook-direct',
            eventType: event.event,
            payload: payload as never,
          },
        }));
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.log(
          `[DomWebhook] ${event.signature} corrida duplicada – ignorando`,
        );
        return;
      }
      throw err;
    }

    try {
      const boundEbook = await this.prisma.transaction.findFirst({
        where: {
          OR: [
            { domPaymentId: event.data.id },
            { externalPaymentId: event.data.id },
            ...(event.data.cod_external
              ? [{ id: event.data.cod_external }]
              : []),
            ...(event.data.external_reference
              ? [{ id: event.data.external_reference }]
              : []),
          ],
        },
        select: { settlementBasis: true },
      });
      if (boundEbook?.settlementBasis === 'EBOOK_V1') {
        const handled = await settleEbookPayment(
          this.prisma,
          event.data.id,
          event.data.status,
          event.data.cod_external ?? event.data.external_reference,
        );
        if (!handled) throw new Error('EBOOK_ENROLLMENT_BINDING_REQUIRED');
        await this.prisma.webhookEvent.update({
          where: { id: wh.id },
          data: { status: 'PROCESSED', processedAt: new Date() },
        });
        return;
      }
      const serial = this.detectSerial(event.data);

      if (serial) {
        await this.handleMachineSync(event, serial);
      } else {
        await this.handleTransaction(event);
      }

      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'PROCESSED', processedAt: new Date(), error: null },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(
        `[DomWebhook] Erro ao processar ${event.signature}: ${msg}`,
      );
      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'FAILED', error: msg, retryCount: { increment: 1 } },
      });
      throw err;
    }
  }

  // ─── Parsing e helpers ────────────────────────────────────────────────────

  private parsePayload(payload: unknown): RawDomWebhook | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.event !== 'string' || typeof p.signature !== 'string')
      return null;
    const d = p.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    if (typeof (d as Record<string, unknown>).id !== 'string') return null;
    return payload as RawDomWebhook;
  }

  private detectSerial(data: RawDomData): string | null {
    if (data.serial_number && machineOwners()[data.serial_number]) {
      return data.serial_number;
    }
    const name = data.customer?.name ?? '';
    const m = name.match(/Terminal:\s*([A-Z0-9]+)/);
    if (m && machineOwners()[m[1]]) return m[1];
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

  private calcNet(
    amountReais: number,
    installments: number = 1,
    liquidAmountReais?: number | null,
    tenantTag?: string,
    paymentMethod?: string,
  ): Prisma.Decimal {
    // Prefer DOM's actual liquid_amount (real net after gateway fees) over formula-based estimate
    if (liquidAmountReais != null && liquidAmountReais > 0) {
      return new Prisma.Decimal(liquidAmountReais);
    }
    return calculateSellerNetValue(
      amountReais,
      installments,
      tenantTag || 'GLOBAL',
      paymentMethod,
    );
  }

  /**
   * Resolve o tenantTag de um usuário sem platform:
   * 1. platform.tag do usuário (existente)
   * 2. GLOBAL como fallback
   */
  private async resolveTenantTagForUser(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { platform: { select: { tag: true } } },
    });
    if (user?.platform?.tag) return user.platform.tag.toUpperCase();
    return 'GLOBAL';
  }

  private getLiquidezFactorByTag(tenantTag?: string): number {
    if (!tenantTag) {
      return getPlatformTaxaEffective('RENOVADA', 'LIQUIDEZ', 0.91);
    }
    return getPlatformTaxaEffective(
      tenantTag.toUpperCase(),
      'LIQUIDEZ',
      PLATFORM_TAXA_DEFAULTS.LIQUIDEZ ?? 0.91,
    );
  }

  private calcPaymentMethod(method?: string): PaymentMethod {
    return method?.toLowerCase().includes('card')
      ? PaymentMethod.CREDIT_CARD
      : PaymentMethod.PIX;
  }

  // ─── Transação regular ────────────────────────────────────────────────────

  private async handleTransaction(event: RawDomWebhook): Promise<void> {
    const { data } = event;
    const nextStatus = this.mapStatus(data.status);
    if (!nextStatus) {
      this.logger.warn(
        `[DomWebhook] Status desconhecido "${data.status}" – ignorando`,
      );
      return;
    }

    // DOM Pagamentos envia amount e liquid_amount em CENTAVOS → dividir por 100
    const amountDec = new Prisma.Decimal(data.amount / 100);

    const chargeReference = linkChargeReference(
      data.description ?? data.product_first ?? data.items?.[0]?.description,
    );
    const existing = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          { domPaymentId: data.id },
          // Seller entry paid through the public checkout: it keeps its EBOOK_PENDING_ key and is matched by the
          // payment it was bound to or, before that write lands (early card webhook), by the cod_external the
          // checkout sent (the entry id).
          {
            externalPaymentId: data.id,
            acquirer: 'DOM',
            domPaymentId: { startsWith: EBOOK_PENDING_PREFIX },
          },
          ...(data.cod_external
            ? [
                {
                  id: data.cod_external,
                  domPaymentId: { startsWith: EBOOK_PENDING_PREFIX },
                },
              ]
            : []),
          ...(chargeReference
            ? [{ id: chargeReference, settlementBasis: 'FINAL_NET' }]
            : []),
        ],
      },
    });

    if (existing?.domPaymentId?.startsWith(EBOOK_PENDING_PREFIX)) {
      await this.handleBoundEbookEntry(existing, data, nextStatus);
      return;
    }

    if (existing) {
      if (existing.status === nextStatus) {
        if (
          this.queue &&
          platformTaxaTagForTransaction(existing) === 'ZERO-GRAU'
        ) {
          await this.queue.publish(QueueNames.ZERO_GRAU_NOTIFICATIONS, {
            paymentId: data.id,
            status: nextStatus,
          });
        }
        return;
      }

      // Transação paga não regride para PENDING/FAILED/EXPIRED: essa regressão não estorna o saldo,
      // e o próximo "paid" creditaria a wallet de novo (crédito duplicado).
      if (
        existing.status === TransactionStatus.COMPLETED &&
        (nextStatus === TransactionStatus.PENDING ||
          nextStatus === TransactionStatus.FAILED ||
          nextStatus === TransactionStatus.EXPIRED)
      ) {
        this.logger.warn(
          `[DomWebhook] Ignorando regressão COMPLETED → ${nextStatus} da tx ${existing.id} (domPaymentId=${data.id})`,
        );
        return;
      }

      const isRenovada = platformTaxaTagForTransaction(existing) === 'RENOVADA';
      const isBosque = platformTaxaTagForTransaction(existing) === 'BOSQUE';
      // Renovada/Bosque: wallet stores net (DOM liquid_amount). Use liquid from webhook when available,
      // fall back to stored netAmount, then gross as last resort.
      let delta: Prisma.Decimal;
      if (
        existing.settlementBasis === 'FINAL_NET' ||
        (/^[a-f0-9]{64}$/.test(existing.id) && existing.netAmount != null)
      ) {
        delta = new Prisma.Decimal(existing.netAmount!);
      } else if (isRenovada || isBosque) {
        const domLiquid =
          data.liquid_amount != null
            ? new Prisma.Decimal(data.liquid_amount / 100)
            : null;
        delta =
          domLiquid ??
          (existing.netAmount != null
            ? new Prisma.Decimal(existing.netAmount.toString())
            : amountDec);
      } else if (transactionPlatformTag(existing) === 'AREAFLIX') {
        // AREAFLIX: netAmount já é o líquido final do vendedor (% método + fixa
        // descontados na criação da transação) — sem taxas extras aqui.
        delta =
          existing.netAmount != null
            ? new Prisma.Decimal(existing.netAmount.toString())
            : amountDec;
      } else if (transactionPlatformTag(existing) === 'EBOOK') {
        // EBOOK: líquido = netAmount; TAXA_SERVICO só vale para vendas anteriores ao corte (getEbookTaxaServico).
        const netAmountDec =
          existing.netAmount != null
            ? new Prisma.Decimal(existing.netAmount.toString())
            : amountDec;
        delta = netAmountDec.sub(getEbookTaxaServico(existing.createdAt));
      } else {
        const feeTag = 'GLOBAL';
        delta = (
          existing.netAmount != null
            ? new Prisma.Decimal(existing.netAmount)
            : amountDec
        )
          .sub(
            getPlatformTaxaEffective(
              feeTag,
              'TAXA_FIXA_TRANSACAO',
              PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
            ),
          )
          .sub(LEGACY_DOM_CASHBACK_REAIS)
          .sub(
            getPlatformTaxaEffective(
              feeTag,
              'TAXA_SERVICO',
              PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
            ),
          );
      }

      const applied = await this.prisma.$transaction(async (p) => {
        if (existing.settlementBasis === 'FINAL_NET') {
          await bindLinkPayment(p, existing, data.id);
          const settled = await settleFinalNet(
            p,
            existing,
            nextStatus,
            'DOM_WEBHOOK',
          );
          if (settled) await markChargeSettled(p, existing.id, nextStatus);
          return settled;
        }
        if (
          existing.status === TransactionStatus.COMPLETED &&
          [
            TransactionStatus.REFUNDED,
            TransactionStatus.CHARGEBACK,
            TransactionStatus.IN_MEDIATION,
          ].includes(nextStatus as never)
        ) {
          delta = await creditedSettlementAmount(p, existing.id, delta);
        }
        // Só aplica se o status ainda for o lido acima: dois webhooks simultâneos não creditam duas vezes.
        const statusChange = await p.transaction.updateMany({
          where: { id: existing.id, status: existing.status },
          data: {
            previousStatus: existing.status,
            status: nextStatus,
            updatedAt: new Date(),
          },
        });
        if (statusChange.count === 0) {
          this.logger.warn(
            `[DomWebhook] Status da tx ${existing.id} já foi alterado por outro webhook – ignorando`,
          );
          return;
        }

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

        const wallet = await p.wallet.findUnique({
          where: { userId: existing.userId },
        });
        if (!wallet) throw new Error('wallet not found');

        await applyWalletEntry(p, {
          userId: existing.userId,
          action: `DOM_WEBHOOK_${nextStatus}`,
          transactionId: existing.id,
          balanceDelta,
          lockedDelta,
          source: 'DOM_WEBHOOK',
        });

        if (
          nextStatus === TransactionStatus.COMPLETED &&
          existing.status !== TransactionStatus.COMPLETED
        ) {
          await this.affiliateCommission.applyForTransaction(p, {
            transactionId: existing.id,
            referredUserId: existing.userId,
            platformFee: existing.platformFee,
          });
        } else if (
          (nextStatus === TransactionStatus.REFUNDED ||
            nextStatus === TransactionStatus.CHARGEBACK) &&
          existing.status === TransactionStatus.COMPLETED
        ) {
          await this.affiliateCommission.reverseForTransaction(p, existing.id);
        }
      });

      if (applied === false) return;

      const eventTag = platformTaxaTagForTransaction(existing);
      if (this.platformEvents && eventTag !== 'GLOBAL')
        this.platformEvents.emit(eventTag, 'transaction', {
          ...existing,
          status: nextStatus,
        });
      const zeroGrauUserId = String(
        getPlatformOwnerId('ZERO-GRAU') ?? '',
      ).trim();
      if (
        zeroGrauUserId &&
        platformTaxaTagForTransaction(existing) === 'ZERO-GRAU'
      ) {
        const notification = { paymentId: data.id, status: nextStatus };
        if (this.queue) {
          await this.queue.publish(
            QueueNames.ZERO_GRAU_NOTIFICATIONS,
            notification,
          );
        } else {
          const result = await notifyZeroGrauPaymentStatus(notification);
          if (result === 'failed') {
            this.logger.warn(
              `[DomWebhook][zero-grau] Falha ao notificar pagamento ${data.id}`,
            );
          }
        }
      }

      if (
        platformTaxaTagForTransaction(existing) === 'RENOVADA' &&
        this.renovadaEvents
      ) {
        if (!this.platformEvents)
          this.renovadaEvents.emitTransaction({
            ...existing,
            status: nextStatus,
          });
      }

      if (
        nextStatus === TransactionStatus.COMPLETED &&
        existing.status !== TransactionStatus.COMPLETED
      ) {
        this.logger.log(
          `[DomWebhook][ebook] tx local ${existing.id} → COMPLETED; tentando notificar back-ebook domPaymentId=${data.id}`,
        );
        void this.tryNotifyBackEbookOrderPaidFromDomWebhook(data);

        // SSE: notificar checkout genérico (ebook/pagatg) pelo domPaymentId
        if (data.id) {
          this.checkoutEvents?.emit({
            domPaymentId: data.id,
            status: 'COMPLETED',
          });
        }

        // VOUCHER: Registrar uso se houver tag [VOUCHER:CODE] na descrição
        const voucherMatch = (existing.description ?? '').match(
          /\[VOUCHER:([^\]]+)\]/,
        );
        if (voucherMatch) {
          const code = voucherMatch[1];
          try {
            const voucher = await this.prisma.voucher.findFirst({
              where: {
                userId: existing.userId,
                code: code.toUpperCase().trim(),
              },
            });
            if (voucher) {
              await this.voucherService.recordUsage({
                voucherId: voucher.id,
                transactionId: existing.id,
                customerEmail: existing.customerEmail ?? '',
                customerDocument: existing.customerDocument ?? '',
                originalAmount: Number(existing.amount),
                discountAmount:
                  Number(existing.amount) -
                  Number(existing.netAmount) /
                    getPlatformTaxaEffective(
                      transactionPlatformTag(existing) === 'EBOOK'
                        ? 'EBOOK'
                        : 'GLOBAL',
                      'LIQUIDEZ',
                      0.91,
                    ), // Aproximação do desconto
                finalAmount: Number(existing.amount),
              });
            }
          } catch (vErr) {
            this.logger.error(
              `Erro ao registrar uso de voucher ${code}: ${vErr.message}`,
            );
          }
        }
      }
    } else {
      const amountReais = Number(data.amount) / 100;
      const topKeys = Object.keys(data as Record<string, unknown>)
        .slice(0, 18)
        .join(',');
      this.logger.log(
        `[DomWebhook][ebook] sem tx prévia domPaymentId=${data.id} status=${data.status} amount≈${amountReais} ` +
          `hasEmail=${Boolean(data.customer?.email)} BACK_EBOOK_URL=${Boolean(String(getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? '').trim())} ` +
          `payloadKeys=[${topKeys}]`,
      );
      // Checkout ebook (back-ebook): não cria transação local antes do pagamento → não há domPaymentId na base.
      // Se o payload da DOM trouxer o número do pedido (ORD-AAAA-NNNNNN), notificamos o back-ebook aqui (substitui api-dom).
      const ebookHandled =
        await this.tryNotifyBackEbookOrderPaidFromDomWebhook(data);
      if (ebookHandled) {
        this.logger.log(
          `[DomWebhook] domPaymentId=${data.id} tratado como ebook: back-ebook notificado (sem tx prévia na machine).`,
        );
        // SSE: notificar checkout mesmo sem tx prévia (ebook sem EBOOK_PENDING)
        if (data.id) {
          this.checkoutEvents?.emit({
            domPaymentId: data.id,
            status: 'COMPLETED',
          });
        }
        return;
      }

      // Segurança anti-mistura:
      // Se não houver transação pré-existente para o domPaymentId, este webhook não tem
      // contexto confiável de tenant para criar uma nova transação sem risco de atribuir
      // ao tenant errado (ex.: Renovada x Bosque). Nesse caso, ignoramos a criação.
      this.logger.warn(
        `[DomWebhook] domPaymentId=${data.id} sem transação prévia. Ignorando criação para evitar mistura de tenant.`,
      );
      alertUnresolvedWebhook(this.logger, 'dom.payment', data.id);
      return;
    }
  }

  /**
   * Detecta pedido ebook (ORD-AAAA-NNNNNN) no payload da DOM e chama o back-ebook com token interno.
   * Fluxo oficial pós api-dom: api-machine recebe webhook DOM → confirma pedido no back-ebook.
   */
  private extractEbookOrderNumberFromDomPayload(
    data: RawDomData,
  ): string | null {
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
    if (
      /["']store["']\s*:\s*["']ebook/.test(s) ||
      /["']store["']\s*:\s*["']ebooksim/.test(s)
    ) {
      return true;
    }
    const checkoutDomain = process.env.SIMPAY_CHECKOUT_URL?.replace(
      /^https?:\/\//i,
      '',
    )
      .split(/[/?#]/)[0]
      .toLowerCase();
    if (
      checkoutDomain &&
      s.includes(checkoutDomain) &&
      (s.includes('ebook') || s.includes('ebooksim'))
    ) {
      return true;
    }
    if (s.includes('back.ebooksim.com')) return true;
    if (/\borderid=/.test(s) && (s.includes('ebook') || s.includes('ebooksim')))
      return true;
    if (
      /\bordernumber=/.test(s) &&
      (s.includes('ebook') || s.includes('ebooksim'))
    )
      return true;
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
      String(
        getPlatformIntegrationValue('EBOOK', 'WEBHOOK_RELAXED') ?? '',
      ).toLowerCase() === 'true' ||
      String(getPlatformIntegrationValue('EBOOK', 'WEBHOOK_RELAXED') ?? '') ===
        '1';

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

    const title = String(
      bodySource.product_first || bodySource.description || '',
    ).trim();
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
  private async fetchDomTransactionDetailJson(
    domPaymentId: string,
  ): Promise<string | null> {
    if (!this.paymentGateway) return null;
    const domToken = String(process.env.DOM_TOKEN ?? '').trim();
    if (!domToken) return null;
    try {
      const detail = await this.paymentGateway.getDomTransactionDetail(
        domToken,
        domPaymentId,
      );
      if (detail == null) return null;
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
    } catch (e) {
      this.logger.warn(
        `[DomWebhook][ebook] GET DOM transactions/${domPaymentId} falhou: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private async tryNotifyBackEbookOrderPaidFromDomWebhook(
    data: RawDomData,
  ): Promise<boolean> {
    const st = String(data.status ?? '').toLowerCase();
    if (
      !['paid', 'approved', 'completed', 'revision_paid', 'capture'].includes(
        st,
      )
    ) {
      this.logger.log(
        `[DomWebhook][ebook] domPaymentId=${data.id} skip_notify reason=status_not_final status=${data.status}`,
      );
      return false;
    }

    const bodySource = data;
    let detect: RawDomData = data;
    const wantEnrich = Boolean(
      String(getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? '').trim(),
    );
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
          description:
            `${String(data.description ?? '')} ${blob.slice(0, 20000)}`.trim(),
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

    const backEbookUrl = String(
      getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? '',
    ).replace(/\/+$/, '');
    const token =
      process.env.API_MACHINE_INTERNAL_TOKEN ||
      process.env.INTERNAL_SERVICE_TOKEN ||
      '';
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

      // Extrair ownerCpf e ownerName da resposta do back-ebook para vincular a transaction ao autor correto
      let ownerCpf: string | null = null;
      let ownerName: string | null = null;
      try {
        const parsed = JSON.parse(text);
        ownerCpf =
          typeof parsed?.ownerCpf === 'string' ? parsed.ownerCpf : null;
        ownerName =
          typeof parsed?.ownerName === 'string'
            ? parsed.ownerName.trim() || null
            : null;
      } catch {
        /* resposta não-JSON, ignorar */
      }

      void this.upsertEbookTransaction(data, orderNumber, ownerCpf, ownerName);

      return true;
    } catch (e) {
      this.logger.error(
        `[DomWebhook][ebook] fetch back-ebook falhou orderRef=${orderNumber} domPaymentId=${data.id}: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
      return true;
    }
  }

  /**
   * Payment bound by the checkout to the seller's pending entry. Only the confirmation acts: it runs the same
   * status-conditional completion (one credit) as the no-prior-transaction path; other statuses leave the entry
   * PENDING so the order can still be paid by a retried checkout. Refunds of these entries are not handled here.
   */
  private async handleBoundEbookEntry(
    entry: Transaction,
    data: RawDomData,
    nextStatus: TransactionStatus,
  ): Promise<void> {
    if (
      nextStatus !== TransactionStatus.COMPLETED ||
      entry.status === TransactionStatus.COMPLETED
    ) {
      this.logger.log(
        `[DomWebhook][ebook] entrada ${entry.id} (${data.status}) sem alteração`,
      );
      return;
    }
    // The charge always covers at least the owner amount of the entry; anything lower is not this order's payment.
    if (data.amount < Math.round(Number(entry.amount) * 100))
      throw new Error('EBOOK_PENDING_AMOUNT_MISMATCH');
    const orderNumber = entry.domPaymentId!.slice(EBOOK_PENDING_PREFIX.length);
    if (!(await this.completeEbookPending(entry, data, orderNumber))) return;
    void this.tryNotifyBackEbookOrderPaidFromDomWebhook(data);
    if (data.id)
      this.checkoutEvents?.emit({ domPaymentId: data.id, status: 'COMPLETED' });
  }

  /**
   * Completes the seller's pending entry with the payment the buyer really made: the single credit path for
   * `EBOOK_PENDING_<order>` entries (webhook without prior transaction, or bound by the public checkout).
   * Conditional on the status, so repeated or concurrent webhooks credit once; throws so the caller may retry.
   * Returns whether this call performed the completion.
   */
  private async completeEbookPending(
    pendingTx: Transaction,
    data: RawDomData,
    orderNumber: string,
  ): Promise<boolean> {
    this.logger.log(
      `[DomWebhook][ebook] atualizando tx PENDING → COMPLETED id=${pendingTx.id}`,
    );
    const amountDec = new Prisma.Decimal(data.amount / 100);
    // Entry recorded by the canonical merchant route: the server already priced it (fees and buyer
    // interest, with the quote kept in financialSnapshot); keep that net instead of the LIQUIDEZ shortcut.
    const canonicalEntry =
      !!pendingTx.financialSnapshot && pendingTx.netAmount !== null;
    const ownerBaseReais = Math.min(
      Number(pendingTx.amount),
      data.amount / 100,
    );
    // The entry is always recorded as PIX 1x at the owner amount (the order exists before the buyer picks
    // card/installments). Once the real card payment is confirmed, reprice the owner share with the paid
    // installments so the interest cost reaches the seller net.
    const cardInstallments = Math.min(
      Math.max(Math.trunc(Number(data.installments ?? 1)) || 1, 1),
      12,
    );
    let cardQuote: Awaited<ReturnType<typeof quoteCardOwnerShare>> = null;
    if (canonicalEntry && /credit/i.test(data.payment_method ?? '')) {
      try {
        cardQuote = await quoteCardOwnerShare(
          this.prisma,
          'EBOOK',
          Math.round(Number(pendingTx.amount) * 100),
          cardInstallments,
        );
        // The owner share never exceeds what the buyer paid in total.
        if (cardQuote && Math.round(cardQuote.totalAmount * 100) > data.amount)
          cardQuote = null;
      } catch (e) {
        this.logger.warn(
          `[DomWebhook][ebook] repricing do cartão falhou orderRef=${orderNumber}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (!cardQuote)
        this.logger.warn(
          `[DomWebhook][ebook] mantendo líquido gravado (PIX) orderRef=${orderNumber} installments=${cardInstallments}`,
        );
    }
    let netDec: Prisma.Decimal;
    if (cardQuote) {
      netDec = new Prisma.Decimal(cardQuote.netAmount);
    } else {
      netDec = canonicalEntry
        ? new Prisma.Decimal(pendingTx.netAmount!.toString())
        : this.calcNet(
            // The entry holds the owner amount (order total minus the affiliate commission, credited apart):
            // pricing the whole payment would credit the commission to the owner as well.
            ownerBaseReais,
            Number(data.installments ?? 1),
            undefined,
            'EBOOK',
            data.payment_method,
          );
    }
    const custName = (data as any).customer_name || data.customer?.name || null;
    const custEmail =
      (data as any).customer_email || data.customer?.email || null;
    const custDoc =
      (
        (data as any).customer_document ||
        data.customer?.document ||
        ''
      ).replace(/\D/g, '') || null;
    const applied = await this.prisma.$transaction(async (p) => {
      // Condicional ao status: webhook repetido/simultâneo não conclui (nem credita) duas vezes
      const completed = await p.transaction.updateMany({
        where: {
          id: pendingTx.id,
          status: { not: TransactionStatus.COMPLETED },
        },
        data: {
          status: 'COMPLETED',
          domPaymentId: data.id,
          amount: amountDec,
          netAmount: netDec,
          totalFee: amountDec.sub(netDec),
          acquirerFee: new Prisma.Decimal(
            cardQuote
              ? cardQuote.domFeeAmount
              : resolveDomFeeReais({
                  amountReais: data.amount / 100,
                  paymentMethod: data.payment_method,
                  installments: Number(data.installments ?? 1),
                  domFeeFromGateway: data.dom_fee,
                  tenantTag: 'EBOOK',
                }),
          ),
          ...(cardQuote
            ? {
                paymentMethod: PaymentMethod.CREDIT_CARD,
                installments: cardInstallments,
                platformFee: new Prisma.Decimal(cardQuote.platformFeeAmount),
                financialSnapshot:
                  cardQuote.financialSnapshot as unknown as Prisma.InputJsonValue,
              }
            : {}),
          customerName: custName,
          customerEmail: custEmail,
          customerDocument: custDoc,
          updatedAt: new Date(),
        },
      });
      if (completed.count === 0) return false;
      const walletDeltaPending = netDec.sub(
        getEbookTaxaServico(pendingTx.createdAt),
      );
      await applyWalletEntry(p, {
        userId: pendingTx.userId,
        action: 'EBOOK_PENDING_COMPLETED',
        source: 'DOM_WEBHOOK',
        platformTag: 'EBOOK',
        nature: 'SALE',
        balanceDelta: walletDeltaPending,
        transactionId: pendingTx.id,
        metadata: ebookOrderCreditMetadata({
          orderNumber,
          baseCents: Math.round(ownerBaseReais * 100),
          paidCents: data.amount,
        }),
      });
      await fundEbookCommission(p, orderNumber);
      return true;
    });
    return applied;
  }

  /** Cria ou garante que existe uma Transaction local para o pedido ebook,
   *  permitindo que /admin/plataformas/ebook/transacoes e /internal/ebook/finance/* funcionem. */
  private async upsertEbookTransaction(
    data: RawDomData,
    orderNumber: string,
    ownerCpf: string | null,
    ownerNameFromBack?: string | null,
  ): Promise<void> {
    try {
      const existing = await this.prisma.transaction.findFirst({
        where: { domPaymentId: data.id },
      });
      if (existing) {
        this.logger.log(
          `[DomWebhook][ebook] tx local já existe id=${existing.id} para domPaymentId=${data.id}`,
        );
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
        if (pendingTx.status === TransactionStatus.COMPLETED) {
          this.logger.log(
            `[DomWebhook][ebook] tx ${pendingTx.id} já está COMPLETED – não credita de novo`,
          );
          return;
        }
        await this.completeEbookPending(pendingTx, data, orderNumber);
        return;
      }

      // Resolve o userId do autor pelo documento (CPF ou CNPJ), se disponível
      let ebookUserId: string | null = null;
      let ownerNameFromSimpay: string | null = null;
      if (ownerCpf) {
        const docClean = ownerCpf.replace(/\D/g, '');
        const isCnpj = docClean.length === 14;
        const author = isCnpj
          ? await this.prisma.user.findFirst({
              where: { cnpj: docClean },
              select: { id: true, name: true },
            })
          : await this.prisma.user.findFirst({
              where: {
                cpf: {
                  in: [
                    docClean,
                    docClean.replace(
                      /(\d{3})(\d{3})(\d{3})(\d{2})/,
                      '$1.$2.$3-$4',
                    ),
                  ],
                },
              },
              select: { id: true, name: true },
            });
        ebookUserId = author?.id ?? null;
        ownerNameFromSimpay = author?.name?.trim() || null;
        if (ebookUserId) {
          this.logger.log(
            `[DomWebhook][ebook] ${isCnpj ? 'CNPJ' : 'CPF'} ${docClean} → userId=${ebookUserId}`,
          );
        } else {
          this.logger.log(
            `[DomWebhook][ebook] ${isCnpj ? 'CNPJ' : 'CPF'} ${docClean} sem conta na api-machine — usando conta genérica ebook`,
          );
        }
      }

      // Autor sem conta ainda: usar conta genérica ebook como placeholder
      if (!ebookUserId) {
        ebookUserId = getPlatformOwnerId('EBOOK') ?? '';
        if (!ebookUserId)
          throw new Error('Plataforma EBOOK sem dono cadastrado');
      }

      await this.prisma.wallet.upsert({
        where: { userId: ebookUserId },
        update: {},
        create: { userId: ebookUserId, balance: 0, lockedBalance: 0 },
      });

      const amountDec = new Prisma.Decimal(data.amount / 100);
      // EBOOK usa só as taxas cadastradas (LIQUIDEZ), não o líquido informado pela DOM
      const netDec = this.calcNet(
        data.amount / 100,
        Number(data.installments ?? 1),
        undefined,
        'EBOOK',
        data.payment_method,
      );

      // Documento do dono na description garante reconhecimento quando ele criar conta no simpay
      // Prioridade: nome vindo do back-ebook (fonte primária) > nome da conta Simpay
      const resolvedOwnerName =
        ownerNameFromBack?.trim() || ownerNameFromSimpay || null;
      const ownerDocClean = ownerCpf ? ownerCpf.replace(/\D/g, '') : '';
      const cpfTag =
        ownerDocClean.length === 14
          ? ` [CNPJ_DONO:${ownerDocClean}]`
          : ownerDocClean.length === 11
            ? ` [CPF_DONO:${ownerDocClean}]`
            : '';
      const nomeTag = resolvedOwnerName
        ? ` [NOME_DONO:${resolvedOwnerName}]`
        : '';
      const description =
        appendInternalTags(orderNumber, [TENANT_EBOOK_TAG]) + cpfTag + nomeTag;

      await this.prisma.$transaction(async (p) => {
        const tx = await p.transaction.create({
          data: {
            userId: ebookUserId,
            domPaymentId: data.id,
            amount: amountDec,
            netAmount: netDec,
            totalFee: amountDec.sub(netDec),
            acquirerFee: new Prisma.Decimal(
              resolveDomFeeReais({
                amountReais: data.amount / 100,
                paymentMethod: data.payment_method,
                installments: Number(data.installments ?? 1),
                domFeeFromGateway: data.dom_fee,
                tenantTag: 'EBOOK',
              }),
            ),
            status: TransactionStatus.COMPLETED,
            paymentMethod: this.calcPaymentMethod(data.payment_method),
            ...transactionPlatformTagData('EBOOK'),
            description,
            installments: Number(data.installments ?? 1),
            customerName:
              (data as any).customer_name || data.customer?.name || '',
            customerEmail:
              (data as any).customer_email || data.customer?.email || '',
            customerDocument: (
              ((data as any).customer_document ||
                data.customer?.document ||
                '') as string
            ).replace(/\D/g, ''),
            customerPhone:
              (data as any).customer_phone || data.customer?.mobile_phone || '',
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
        const walletDeltaEbook = netDec.sub(
          getEbookTaxaServico(
            data.created_at ? new Date(data.created_at) : new Date(),
          ),
        );
        const ebookWallet = await p.wallet.findUnique({
          where: { userId: ebookUserId },
        });
        if (ebookWallet) {
          await applyWalletEntry(p, {
            userId: ebookUserId,
            action: 'DOM_WEBHOOK_COMPLETED',
            transactionId: tx.id,
            platformTag: 'EBOOK',
            nature: 'SALE',
            balanceDelta: walletDeltaEbook,
            lockedDelta: 0,
            source: 'EBOOK_WEBHOOK',
            description: `Pedido ebook: ${orderNumber}`,
            metadata: ebookOrderCreditMetadata({
              orderNumber,
              baseCents: data.amount,
              paidCents: data.amount,
            }),
          });
          await fundEbookCommission(p, orderNumber);
        }

        return tx;
      });

      this.logger.log(
        `[DomWebhook][ebook] Transaction local criada para domPaymentId=${data.id} orderNumber=${orderNumber}`,
      );
    } catch (e) {
      this.logger.error(
        `[DomWebhook][ebook] Falha ao criar transaction local domPaymentId=${data.id}: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ─── Máquinetas físicas ───────────────────────────────────────────────────

  private async handleMachineSync(
    event: RawDomWebhook,
    serial: string,
  ): Promise<void> {
    const { data } = event;

    if (data.status !== 'paid') {
      this.logger.log(
        `[DomWebhook] Máquineta ${serial} status=${data.status} – sem sincronização`,
      );
      return;
    }

    const userId = machineOwners()[serial];
    const matches = registeredPlatformTags().filter((tag) =>
      (getPlatformIntegrationValue(tag, 'MACHINE_SERIALS') ?? '')
        .split(',')
        .map((value) => value.trim())
        .includes(serial),
    );
    if (!userId || matches.length !== 1)
      throw new Error('Terminal sem plataforma única cadastrada');

    const alreadySynced = await this.prisma.transaction.findFirst({
      where: { domPaymentId: data.id, userId },
    });
    if (alreadySynced) {
      this.logger.log(
        `[DomWebhook] Máquineta ${serial} tx ${data.id} já sincronizada`,
      );
      return;
    }

    // Venda FÍSICA (maquineta): o lojista perde apenas a taxa Sim Int Pay configurada
    // em /admin/taxas (POS_TAXA_*); o custo da DOM sai da margem da casa. O
    // `liquid_amount` que a DOM devolve serve só de referência do custo dela.
    // Mesmo modelo do sync-maquinetas — os dois caminhos precisam gravar igual.
    const amountReais = data.amount / 100;
    const platformTag = matches[0];
    let fees = calculateMaquinetaFees(
      platformTag,
      amountReais,
      data.payment_method,
      Number(data.installments ?? 1),
      data.card_brand,
    );
    const financialQuote = data.created_at
      ? quoteReportedPos(
          await loadChargePolicy(
            this.prisma,
            platformTag,
            new Date(data.created_at),
          ),
          amountReais,
          isPhysicalDebit(data.payment_method, data.card_brand)
            ? 'DEBIT_CARD'
            : /card|credit/i.test(data.payment_method ?? '')
              ? 'CREDIT_CARD'
              : 'PIX',
          Number(data.installments ?? 1),
        )
      : null;
    if (financialQuote)
      fees = {
        simIntRate: 0,
        platformFeeAmt: financialQuote.platformProfit,
        netAmount: financialQuote.netAmount,
        domFeeAmt: financialQuote.domFeeAmount,
      };
    const amountDec = new Prisma.Decimal(amountReais);
    const netDec = new Prisma.Decimal(fees.netAmount);

    const tx = await this.prisma.$transaction(async (p) => {
      const newTx = await p.transaction.create({
        data: {
          userId,
          domPaymentId: data.id,
          ...(financialQuote
            ? {
                financialSnapshot: financialQuote.financialSnapshot,
                settlementBasis: 'FINAL_NET' as const,
              }
            : {}),
          amount: amountDec,
          netAmount: netDec,
          totalFee: new Prisma.Decimal(fees.domFeeAmt + fees.platformFeeAmt),
          acquirerFee: new Prisma.Decimal(fees.domFeeAmt),
          platformFee: new Prisma.Decimal(fees.platformFeeAmt),
          status: TransactionStatus.COMPLETED,
          paymentMethod: this.calcPaymentMethod(data.payment_method),
          ...transactionPlatformTagData(platformTag),
          description: appendInternalTags(
            `Sincronização Automática - Terminal: ${serial}`,
            [`[TENANT:${platformTag}]`, ORIGEM_MAQUINETA_TAG],
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

      // Carteira recebe o líquido do lojista = bruto − taxa Sim Int Pay
      const machineWallet = await p.wallet.findUnique({ where: { userId } });
      if (machineWallet) {
        await applyWalletEntry(p, {
          userId,
          action: 'MACHINE_SYNC',
          transactionId: newTx.id,
          balanceDelta: netDec,
          lockedDelta: 0,
          source: 'MACHINE_SYNC',
          description: `Terminal: ${serial}`,
        });
      }

      return newTx;
    });

    if (platformTag === 'RENOVADA' && this.renovadaEvents) {
      this.renovadaEvents.emitTransaction(tx);
    }
    this.logger.log(
      `[DomWebhook] Máquineta sincronizada: ${serial} → tx ${tx.id}`,
    );
  }
}
