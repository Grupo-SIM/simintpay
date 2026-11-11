import { settleEbookPayment } from '../../../modules/platform-core/ebook-settlement';
import { settleFinancialSubscription } from '../../../modules/financial-policy/financial-subscription';
import { applyWalletEntry } from '../../../modules/wallet-ledger/wallet-ledger';
import {
  loadChargePolicy,
  quoteReportedPos,
} from '../../../modules/financial-policy/financial-charge';
import { isPhysicalDebit } from '../../helpers/dom-fee-estimate.helper';
import { accessDaysForFrequency } from '../../helpers/billing-frequency.helper';
import { markChargeSettled } from '../../../modules/billing-core/charge-settlement';
import {
  creditedSettlementAmount,
  bindLinkPayment,
  linkChargeReference,
  settleFinalNet,
} from '../../../modules/platform-core/link-settlement';
import { PlatformEventsService } from '../../../modules/platform-core/platform-events.service';
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
import { Prisma, PaymentMethod, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaEventsService } from '../../../modules/renovada/events/renovada-events.service';
import { CommunityManagementService } from '../../services/community-management.service';
import { EmailService } from '../../../infrastructure/email/email.service';
import { PixPlanService } from '../pix-plan/pix-plan.service';
import { PixPlanEventsService } from '../../services/pix-plan-events.service';
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
import {
  documentType,
  splitDocument as provisionDocPayload,
} from '../../utils/document.util';
import {
  isAreaflixLink,
  calculateAreaflixSellerNet,
} from '../../helpers/areaflix-fees.helper';
import { notifyZeroGrauPaymentStatus } from '../../../modules/zero-grau/services/zero-grau-webhook-notifier';
import {
  resolveLinkDelivery,
  sendLinkDelivery,
} from '../payment-link/payment-link-delivery';

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
    @Optional() private readonly communities?: CommunityManagementService,
    @Optional() private readonly emailService?: EmailService,
    @Optional()
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway?: IPaymentGateway,
    @Optional() private readonly pixPlanService?: PixPlanService,
    @Optional() private readonly pixPlanEvents?: PixPlanEventsService,
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
        // Verificar se é uma SubscriptionLinkOrder
        const handled = await this.handleSubscriptionLinkPix(
          event.data.id,
          event.data.status,
          wh.id,
        );
        if (!handled) {
          await this.handleTransaction(event);
        }
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
   * 2. plataformas[0] de qualquer plano ativo do usuário
   * 3. GLOBAL como fallback
   */
  private async resolveTenantTagForUser(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        platform: { select: { tag: true } },
        plans: {
          where: { isActive: true },
          select: { plataformas: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
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
          ...(chargeReference
            ? [{ id: chargeReference, settlementBasis: 'FINAL_NET' }]
            : []),
        ],
      },
    });

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
        // EBOOK: líquido = netAmount (% LIQUIDEZ) − TAXA_SERVICO, as taxas cadastradas exibidas em /taxa.
        const netAmountDec =
          existing.netAmount != null
            ? new Prisma.Decimal(existing.netAmount.toString())
            : amountDec;
        delta = netAmountDec.sub(getEbookTaxaServico());
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

        if (transactionPlatformTag(existing) === 'CONTROLE-MOTORISTA') {
          void this.tryProvisionControleMotoristaUser(data, existing);
          void this.upsertPlatformSubscriberAccess(
            'CONTROLE-MOTORISTA',
            existing.id,
            data,
            existing,
          );
        }

        if (transactionPlatformTag(existing) === 'CONTROLE-PATRIMONIAL') {
          void this.tryProvisionControlePatrimonialUser(data, existing);
          void this.upsertPlatformSubscriberAccess(
            'CONTROLE-PATRIMONIAL',
            existing.id,
            data,
            existing,
          );
        }

        // PIX-PLAN: creditar dias se a transação tiver um PixPlanOrder
        if (this.pixPlanService) {
          try {
            await this.pixPlanService.handlePixPlanWebhook(existing.id, {
              name: data.customer?.name ?? '',
              email: data.customer?.email ?? '',
              document: data.customer?.document ?? '',
              document_type: documentType(data.customer?.document),
              mobile_phone: data.customer?.mobile_phone,
            });
          } catch (pixPlanError: any) {
            this.logger.error(
              `[DomWebhook] Erro ao processar PIX-PLAN para tx ${existing.id}: ${pixPlanError.message}`,
            );
          }
        }

        // SSE: notificar checkout de planos PIX em tempo real
        this.pixPlanEvents?.emit({
          transactionId: existing.id,
          status: 'COMPLETED',
        });

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

        // PDF delivery / e-mail de ebook personalizado do link de pagamento
        if (existing.paymentLinkId && this.emailService) {
          void this.sendPaymentLinkFilesToCustomer(existing);
        }

        // Notificar webhook externo configurado no link de pagamento (ex: areaflix)
        if (existing.paymentLinkId) {
          void this.notifyPaymentLinkExternalWebhook(
            existing,
            'purchase_approved',
          );
        }

        // BETAI: pagamento do link de ENTRADA (R$249,99, pagamento único) → provisiona
        // a conta no Betai (cria conta + envia senha por e-mail). Gated pelo id do link.
        if (
          existing.paymentLinkId &&
          existing.paymentLinkId ===
            String(
              getPlatformIntegrationValue('BETAI', 'ENTRY_LINK_ID') ?? '',
            ).trim()
        ) {
          void this.tryProvisionBetaiUser(data, existing);
        }
      }

      // Reembolso/chargeback de link de pagamento: notificar webhook externo para revogar acesso
      if (
        (nextStatus === TransactionStatus.REFUNDED ||
          nextStatus === TransactionStatus.CHARGEBACK) &&
        existing.status === TransactionStatus.COMPLETED &&
        existing.paymentLinkId
      ) {
        void this.notifyPaymentLinkExternalWebhook(
          existing,
          'purchase_refunded',
        );
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

  private async tryProvisionBetaiUser(
    data: RawDomData,
    existing: { customerEmail?: string | null; customerName?: string | null },
  ): Promise<void> {
    const url = String(
      getPlatformIntegrationValue('BETAI', 'BACKEND_URL') ?? '',
    ).replace(/\/+$/, '');
    const token =
      process.env.API_MACHINE_INTERNAL_TOKEN ||
      process.env.INTERNAL_SERVICE_TOKEN ||
      '';
    if (!url || !token) {
      this.logger.warn(
        `[DomWebhook][betai] BETAI_URL ou token não configurado — provisão ignorada domPaymentId=${data.id}`,
      );
      return;
    }
    const email = data.customer?.email ?? existing.customerEmail ?? '';
    const name = data.customer?.name ?? existing.customerName ?? '';
    if (!email || !name) {
      this.logger.warn(
        `[DomWebhook][betai] email ou nome ausente — provisão ignorada domPaymentId=${data.id}`,
      );
      return;
    }
    const endpoint = `${url}/internal/users/provision`;
    this.logger.log(
      `[DomWebhook][betai] POST ${endpoint} email=${email} domPaymentId=${data.id}`,
    );
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({
          email,
          name,
          ...provisionDocPayload(data.customer?.document),
          phone: data.customer?.mobile_phone,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.error(
          `[DomWebhook][betai] provision HTTP ${res.status}: ${text.slice(0, 300)}`,
        );
        return;
      }
      this.logger.log(
        `[DomWebhook][betai] provision OK email=${email} domPaymentId=${data.id}`,
      );
    } catch (e: any) {
      this.logger.error(
        `[DomWebhook][betai] fetch falhou domPaymentId=${data.id}: ${e?.message}`,
      );
    }
  }

  private async tryProvisionControleMotoristaUser(
    data: RawDomData,
    existing: { customerEmail?: string | null; customerName?: string | null },
  ): Promise<void> {
    const url = String(
      getPlatformIntegrationValue('CONTROLE-MOTORISTA', 'BACKEND_URL') ?? '',
    ).replace(/\/+$/, '');
    const token =
      process.env.API_MACHINE_INTERNAL_TOKEN ||
      process.env.INTERNAL_SERVICE_TOKEN ||
      '';
    if (!url || !token) {
      this.logger.warn(
        `[DomWebhook][controle-motorista] CONTROLE_MOTORISTA_URL ou token não configurado — provisão ignorada domPaymentId=${data.id}`,
      );
      return;
    }
    const email = data.customer?.email ?? existing.customerEmail ?? '';
    const name = data.customer?.name ?? existing.customerName ?? '';
    if (!email || !name) {
      this.logger.warn(
        `[DomWebhook][controle-motorista] email ou nome ausente — provisão ignorada domPaymentId=${data.id}`,
      );
      return;
    }
    const endpoint = `${url}/internal/users/provision`;
    this.logger.log(
      `[DomWebhook][controle-motorista] POST ${endpoint} email=${email} domPaymentId=${data.id}`,
    );
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({
          email,
          name,
          ...provisionDocPayload(data.customer?.document),
          phone: data.customer?.mobile_phone,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.error(
          `[DomWebhook][controle-motorista] provision HTTP ${res.status}: ${text.slice(0, 300)}`,
        );
        return;
      }
      this.logger.log(
        `[DomWebhook][controle-motorista] provision OK email=${email} domPaymentId=${data.id}`,
      );
    } catch (e: any) {
      this.logger.error(
        `[DomWebhook][controle-motorista] fetch falhou domPaymentId=${data.id}: ${e?.message}`,
      );
    }
  }

  private async tryProvisionControlePatrimonialUser(
    data: RawDomData,
    existing: { customerEmail?: string | null; customerName?: string | null },
  ): Promise<void> {
    const url = String(
      getPlatformIntegrationValue('CONTROLE-PATRIMONIAL', 'BACKEND_URL') ?? '',
    ).replace(/\/+$/, '');
    const token =
      process.env.API_MACHINE_INTERNAL_TOKEN ||
      process.env.INTERNAL_SERVICE_TOKEN ||
      '';
    if (!url || !token) {
      this.logger.warn(
        `[DomWebhook][controle-patrimonial] CONTROLE_PATRIMONIAL_URL ou token não configurado — provisão ignorada domPaymentId=${data.id}`,
      );
      return;
    }
    const email = data.customer?.email ?? existing.customerEmail ?? '';
    const name = data.customer?.name ?? existing.customerName ?? '';
    if (!email || !name) {
      this.logger.warn(
        `[DomWebhook][controle-patrimonial] email ou nome ausente — provisão ignorada domPaymentId=${data.id}`,
      );
      return;
    }
    const endpoint = `${url}/internal/users/provision`;
    this.logger.log(
      `[DomWebhook][controle-patrimonial] POST ${endpoint} email=${email} domPaymentId=${data.id}`,
    );
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({
          email,
          name,
          ...provisionDocPayload(data.customer?.document),
          phone: data.customer?.mobile_phone,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.error(
          `[DomWebhook][controle-patrimonial] provision HTTP ${res.status}: ${text.slice(0, 300)}`,
        );
        return;
      }
      this.logger.log(
        `[DomWebhook][controle-patrimonial] provision OK email=${email} domPaymentId=${data.id}`,
      );
    } catch (e: any) {
      this.logger.error(
        `[DomWebhook][controle-patrimonial] fetch falhou domPaymentId=${data.id}: ${e?.message}`,
      );
    }
  }

  private async upsertPlatformSubscriberAccess(
    platformTag: string,
    transactionId: string,
    data: RawDomData,
    existing: { customerEmail?: string | null; customerName?: string | null },
    planDays = 30,
  ): Promise<void> {
    const PLAN_DAYS = planDays > 0 ? planDays : 30;
    const email = (data.customer?.email ?? existing.customerEmail ?? '')
      .toLowerCase()
      .trim();
    if (!email) return;
    const name = data.customer?.name ?? existing.customerName ?? undefined;
    const cpf = data.customer?.document ?? undefined;
    const phone = data.customer?.mobile_phone ?? undefined;
    const rawMethod = (data.payment_method ?? '').toUpperCase();
    const lastPaymentMethod =
      rawMethod.includes('CREDIT') || rawMethod.includes('CARD')
        ? 'CREDIT_CARD'
        : 'PIX';
    const now = new Date();

    try {
      const current = await (
        this.prisma as any
      ).platformSubscriberAccess.findUnique({
        where: {
          platformTag_customerEmail: { platformTag, customerEmail: email },
        },
      });

      if (current) {
        // Calcula a base para extensão considerando 3 cenários:
        // 1. Ativo com dias restantes → estende do expiresAt atual
        // 2. Pausado com dias congelados → devolve os dias congelados + adiciona os novos
        // 3. Expirado → começa do zero a partir de agora
        let base: Date;
        if (current.isActive && current.expiresAt > now) {
          base = current.expiresAt;
        } else if (!current.isActive && current.frozenDays > 0) {
          base = new Date(
            now.getTime() + current.frozenDays * 24 * 60 * 60 * 1000,
          );
        } else {
          base = now;
        }
        const newExpiry = new Date(
          base.getTime() + PLAN_DAYS * 24 * 60 * 60 * 1000,
        );
        await (this.prisma as any).platformSubscriberAccess.update({
          where: {
            platformTag_customerEmail: { platformTag, customerEmail: email },
          },
          data: {
            isActive: true,
            expiresAt: newExpiry,
            frozenDays: 0,
            totalDaysCredited: current.totalDaysCredited + PLAN_DAYS,
            lastTransactionId: transactionId,
            lastPaymentMethod,
            customerName: name ?? current.customerName,
            customerCpf: cpf ?? current.customerCpf,
            customerPhone: phone ?? current.customerPhone,
          },
        });
      } else {
        const newExpiry = new Date(
          now.getTime() + PLAN_DAYS * 24 * 60 * 60 * 1000,
        );
        await (this.prisma as any).platformSubscriberAccess.create({
          data: {
            platformTag,
            customerEmail: email,
            customerName: name ?? null,
            customerCpf: cpf ?? null,
            customerPhone: phone ?? null,
            isActive: true,
            expiresAt: newExpiry,
            frozenDays: 0,
            totalDaysCredited: PLAN_DAYS,
            lastTransactionId: transactionId,
            lastPaymentMethod,
          },
        });
      }
      this.logger.log(
        `[DomWebhook][${platformTag}] PlatformSubscriberAccess upserted email=${email} +${PLAN_DAYS}d`,
      );
    } catch (e: any) {
      this.logger.error(
        `[DomWebhook][${platformTag}] PlatformSubscriberAccess upsert falhou: ${e?.message}`,
      );
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
        this.logger.log(
          `[DomWebhook][ebook] atualizando tx PENDING → COMPLETED id=${pendingTx.id}`,
        );
        const amountDec = new Prisma.Decimal(data.amount / 100);
        // EBOOK usa só as taxas cadastradas (LIQUIDEZ), não o líquido informado pela DOM
        const netDec = this.calcNet(
          data.amount / 100,
          Number(data.installments ?? 1),
          undefined,
          'EBOOK',
          data.payment_method,
        );
        const custName =
          (data as any).customer_name || data.customer?.name || null;
        const custEmail =
          (data as any).customer_email || data.customer?.email || null;
        const custDoc =
          (
            (data as any).customer_document ||
            data.customer?.document ||
            ''
          ).replace(/\D/g, '') || null;
        await this.prisma.$transaction(async (p) => {
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
              acquirerFee: new Prisma.Decimal(data.dom_fee ?? 0),
              customerName: custName,
              customerEmail: custEmail,
              customerDocument: custDoc,
              updatedAt: new Date(),
            },
          });
          if (completed.count === 0) return;
          const walletDeltaPending = netDec.sub(getEbookTaxaServico());
          await applyWalletEntry(p, {
            userId: pendingTx.userId,
            action: 'EBOOK_PENDING_COMPLETED',
            source: 'DOM_WEBHOOK',
            balanceDelta: walletDeltaPending,
            transactionId: pendingTx.id,
          });
        });
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
            acquirerFee: new Prisma.Decimal(data.dom_fee ?? 0),
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
        const walletDeltaEbook = netDec.sub(getEbookTaxaServico());
        const ebookWallet = await p.wallet.findUnique({
          where: { userId: ebookUserId },
        });
        if (ebookWallet) {
          await applyWalletEntry(p, {
            userId: ebookUserId,
            action: 'DOM_WEBHOOK_COMPLETED',
            transactionId: tx.id,
            balanceDelta: walletDeltaEbook,
            lockedDelta: 0,
            source: 'EBOOK_WEBHOOK',
            description: `Pedido ebook: ${orderNumber}`,
          });
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
    if (domStatus === 'paid' && order.financialSnapshot)
      await settleFinancialSubscription(this.prisma, {
        snapshot: order.financialSnapshot,
        amount: order.amountCharged,
        paymentId: domPixPaymentId,
        userId: order.userId,
        method: 'PIX',
        name: order.subscriptionLink.name,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerDocument: order.customerDocument,
        tracking: order.tracking,
      });

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
        data: { status: 'PROCESSED', processedAt: new Date(), error: null },
      });
      return true;
    }

    // Já processado
    if (order.status === 'paid') {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventDbId },
        data: { status: 'PROCESSED', processedAt: new Date(), error: null },
      });
      return true;
    }

    // Marcar como pago
    await this.prisma.subscriptionLinkOrder.update({
      where: { id: order.id },
      data: { status: 'paid' },
    });

    // SSE: notificar checkout de assinatura em tempo real
    this.checkoutEvents?.emit({
      domPaymentId: domPixPaymentId,
      status: 'COMPLETED',
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
          this.logger.log(
            `[DomWebhook] Acesso à comunidade ativado para order ${order.id}`,
          );
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
        if (order.subscriptionLink.emailBody?.trim()) {
          await this.emailService.sendEbookAccessEmail({
            to: order.customerEmail,
            customerName: order.customerName,
            title: order.subscriptionLink.name,
            body: order.subscriptionLink.emailBody,
            redirectUrl: order.subscriptionLink.redirectUrl ?? null,
          });
        } else {
          await this.emailService.sendSubscriptionAccess({
            to: order.customerEmail,
            customerName: order.customerName,
            linkName: order.subscriptionLink.name,
            redirectUrl: order.subscriptionLink.redirectUrl ?? null,
            orderId: order.id,
          });
        }
        this.logger.log(
          `[DomWebhook] Email de acesso enviado para ${order.customerEmail}`,
        );
      } catch (err: unknown) {
        this.logger.error(
          `[DomWebhook] Erro ao enviar email para order ${order.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }

    // AREAFLIX: líquido do vendedor = valor − % do método − taxa fixa (taxas do painel)
    const isAfSubLink =
      !order.financialSnapshot &&
      isAreaflixLink({
        webhookUrl: order.subscriptionLink.webhookUrl,
        platformTag: (order.subscriptionLink as any).platformTag,
        plataformas: (order.subscriptionLink as any).plataformas,
      });
    const afSubNet = isAfSubLink
      ? calculateAreaflixSellerNet(Number(order.amountCharged), 'PIX')
      : null;

    // Notificar webhook externo configurado no link (ex: saas-netflix-back para atualizar plano)
    const webhookUrl = order.subscriptionLink.webhookUrl ?? null;
    if (webhookUrl) {
      const simpayToken = process.env.SIMPAY_WEBHOOK_TOKEN ?? '';
      fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-simpay-token': simpayToken,
        },
        body: JSON.stringify({
          event: 'subscription_activated',
          customerEmail: order.customerEmail,
          customerName: order.customerName,
          planName: order.subscriptionLink.name,
          paymentMethod: 'PIX',
          frequencyType: order.subscriptionLink.frequencyType,
          amountCharged: Number(order.amountCharged),
          netAmount:
            afSubNet ??
            Number(
              (
                Number(order.amountCharged) -
                Number(order.platformFeeAmount ?? 0)
              ).toFixed(2),
            ),
          orderId: order.id,
          linkId: order.subscriptionLinkId,
          ...provisionDocPayload(order.customerDocument),
          phone: order.customerPhone ?? undefined,
        }),
      }).catch((err: unknown) => {
        this.logger.warn(
          `[DomWebhook] Falha ao notificar webhookUrl ${webhookUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    const whAf = (order.subscriptionLink.webhookUrl ?? '').toLowerCase();
    // platformTag explícito tem prioridade; fallback legado: webhookUrl contém 'areaflix'
    const subPlatformTag = (
      order.subscriptionLink.platformTag ||
      (order.subscriptionLink as any).plataformas?.[0] ||
      (whAf.includes('areaflix') ? 'AREAFLIX' : '')
    ).toUpperCase();

    if (
      subPlatformTag &&
      subPlatformTag !== 'GLOBAL' &&
      order.domPixPaymentId
    ) {
      // Cria transação com [TENANT:{platform}] para QUALQUER plataforma associada ao link
      const exists = await this.prisma.transaction.findFirst({
        where: { domPaymentId: order.domPixPaymentId },
        select: { id: true },
      });
      if (!exists) {
        const gross = Number(order.amountCharged);
        const pf = Number(order.platformFeeAmount);
        const netForSeller = afSubNet ?? gross - pf;
        const newTx = await this.prisma.transaction.create({
          data: {
            userId: order.userId,
            amount: gross,
            netAmount: netForSeller,
            status: TransactionStatus.COMPLETED,
            paymentMethod: PaymentMethod.PIX,
            totalFee: afSubNet != null ? gross - netForSeller : 0,
            acquirerFee: 0,
            platformFee: afSubNet != null ? gross - netForSeller : pf,
            description: `${order.subscriptionLink.name} [TENANT:${subPlatformTag}] subOrder=${order.id}`,
            domPaymentId: order.domPixPaymentId,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerDocument: order.customerDocument,
            customerPhone: order.customerPhone ?? undefined,
            tracking: (order.tracking ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
          },
        });

        // AREAFLIX: creditar a carteira do dono do link com o líquido
        // (ativação PIX não passava por nenhum crédito de carteira)
        if (afSubNet != null) {
          const netDec = new Prisma.Decimal(afSubNet.toFixed(2));
          try {
            await this.prisma.$transaction((tx) =>
              applyWalletEntry(tx, {
                userId: order.userId,
                action: 'SUBSCRIPTION_LINK_PIX',
                source: 'SUBSCRIPTION_LINK',
                balanceDelta: netDec,
                transactionId: newTx.id,
                description: `Assinatura areaflix ${order.subscriptionLink.name} subOrder=${order.id}`,
              }),
            );
          } catch (err: unknown) {
            this.logger.error(
              `[DomWebhook] Falha ao creditar carteira areaflix (order ${order.id}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // Comissão de afiliado (baseada no platformFee, independente da plataforma/tenant)
        try {
          await this.prisma.$transaction((p) =>
            this.affiliateCommission.applyForTransaction(p, {
              transactionId: newTx.id,
              referredUserId: order.userId,
              platformFee: newTx.platformFee,
            }),
          );
        } catch (err: unknown) {
          this.logger.error(
            `[DomWebhook] Falha ao creditar comissão de afiliado (subOrder ${order.id}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // CONTROLE-MOTORISTA: provisionar conta no saas-consumo-back
      if (subPlatformTag === 'CONTROLE-MOTORISTA') {
        const url = String(
          getPlatformIntegrationValue('CONTROLE-MOTORISTA', 'BACKEND_URL') ??
            '',
        ).replace(/\/+$/, '');
        const token =
          process.env.API_MACHINE_INTERNAL_TOKEN ||
          process.env.INTERNAL_SERVICE_TOKEN ||
          '';
        if (!url || !token) {
          this.logger.warn(
            '[DomWebhook][CONTROLE-MOTORISTA] CONTROLE_MOTORISTA_URL ou token não configurado — provisão e acesso ignorados',
          );
        } else if (order.customerEmail && order.customerName) {
          fetch(`${url}/internal/users/provision`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-internal-token': token,
            },
            body: JSON.stringify({
              email: order.customerEmail,
              name: order.customerName,
              ...provisionDocPayload(order.customerDocument),
              phone: order.customerPhone ?? undefined,
            }),
          })
            .then(async (r) => {
              const t = await r.text();
              this.logger.log(
                `[DomWebhook][CONTROLE-MOTORISTA] provision HTTP ${r.status} email=${order.customerEmail}: ${t.slice(0, 200)}`,
              );
            })
            .catch((err: unknown) => {
              this.logger.warn(
                `[DomWebhook][CONTROLE-MOTORISTA] provision falhou: ${err instanceof Error ? err.message : String(err)}`,
              );
            });

          // Registra/estende acesso no PlatformSubscriberAccess
          void this.upsertPlatformSubscriberAccess(
            'CONTROLE-MOTORISTA',
            order.id,
            {
              id: order.domPixPaymentId ?? order.id,
              amount: Number(order.amountCharged),
              status: 'approved',
              payment_method: 'pix',
              customer: {
                email: order.customerEmail,
                name: order.customerName,
                document: order.customerDocument ?? undefined,
                mobile_phone: order.customerPhone ?? undefined,
              },
            } as any,
            {
              customerEmail: order.customerEmail,
              customerName: order.customerName,
            },
            accessDaysForFrequency(order.subscriptionLink?.frequencyType),
          );
        }
      }
      // CONTROLE-PATRIMONIAL: provisionar conta no saas-controle-patrimonial-back
      if (subPlatformTag === 'CONTROLE-PATRIMONIAL') {
        const url = String(
          getPlatformIntegrationValue('CONTROLE-PATRIMONIAL', 'BACKEND_URL') ??
            '',
        ).replace(/\/+$/, '');
        const token =
          process.env.API_MACHINE_INTERNAL_TOKEN ||
          process.env.INTERNAL_SERVICE_TOKEN ||
          '';
        if (!url || !token) {
          this.logger.warn(
            '[DomWebhook][CONTROLE-PATRIMONIAL] CONTROLE_PATRIMONIAL_URL ou token não configurado — provisão e acesso ignorados',
          );
        } else if (order.customerEmail && order.customerName) {
          fetch(`${url}/internal/users/provision`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-internal-token': token,
            },
            body: JSON.stringify({
              email: order.customerEmail,
              name: order.customerName,
              ...provisionDocPayload(order.customerDocument),
              phone: order.customerPhone ?? undefined,
            }),
          })
            .then(async (r) => {
              const t = await r.text();
              this.logger.log(
                `[DomWebhook][CONTROLE-PATRIMONIAL] provision HTTP ${r.status} email=${order.customerEmail}: ${t.slice(0, 200)}`,
              );
            })
            .catch((err: unknown) => {
              this.logger.warn(
                `[DomWebhook][CONTROLE-PATRIMONIAL] provision falhou: ${err instanceof Error ? err.message : String(err)}`,
              );
            });

          // Registra/estende acesso no PlatformSubscriberAccess
          void this.upsertPlatformSubscriberAccess(
            'CONTROLE-PATRIMONIAL',
            order.id,
            {
              id: order.domPixPaymentId ?? order.id,
              amount: Number(order.amountCharged),
              status: 'approved',
              payment_method: 'pix',
              customer: {
                email: order.customerEmail,
                name: order.customerName,
                document: order.customerDocument ?? undefined,
                mobile_phone: order.customerPhone ?? undefined,
              },
            } as any,
            {
              customerEmail: order.customerEmail,
              customerName: order.customerName,
            },
            accessDaysForFrequency(order.subscriptionLink?.frequencyType),
          );
        }
      }
      // BETAI: provisionar conta no betai (investidor) após pagamento
      if (subPlatformTag === 'BETAI') {
        const url = String(
          getPlatformIntegrationValue('BETAI', 'BACKEND_URL') ?? '',
        ).replace(/\/+$/, '');
        const token =
          process.env.API_MACHINE_INTERNAL_TOKEN ||
          process.env.INTERNAL_SERVICE_TOKEN ||
          '';
        if (!url || !token) {
          this.logger.warn(
            '[DomWebhook][BETAI] BETAI_URL ou token não configurado — provisão e acesso ignorados',
          );
        } else if (order.customerEmail && order.customerName) {
          fetch(`${url}/internal/users/provision`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-internal-token': token,
            },
            body: JSON.stringify({
              email: order.customerEmail,
              name: order.customerName,
              ...provisionDocPayload(order.customerDocument),
              phone: order.customerPhone ?? undefined,
            }),
          })
            .then(async (r) => {
              const t = await r.text();
              this.logger.log(
                `[DomWebhook][BETAI] provision HTTP ${r.status} email=${order.customerEmail}: ${t.slice(0, 200)}`,
              );
            })
            .catch((err: unknown) => {
              this.logger.warn(
                `[DomWebhook][BETAI] provision falhou: ${err instanceof Error ? err.message : String(err)}`,
              );
            });

          // Registra/estende acesso no PlatformSubscriberAccess
          void this.upsertPlatformSubscriberAccess(
            'BETAI',
            order.id,
            {
              id: order.domPixPaymentId ?? order.id,
              amount: Number(order.amountCharged),
              status: 'approved',
              payment_method: 'pix',
              customer: {
                email: order.customerEmail,
                name: order.customerName,
                document: order.customerDocument ?? undefined,
                mobile_phone: order.customerPhone ?? undefined,
              },
            } as any,
            {
              customerEmail: order.customerEmail,
              customerName: order.customerName,
            },
            accessDaysForFrequency(order.subscriptionLink?.frequencyType),
          );
        }
      }
    } else if (order.domPixPaymentId) {
      // Fallback: link sem plataforma associada → verifica vínculo com comunidade
      const hasCommunity = await this.prisma.communityLinkBinding.findFirst({
        where: { subscriptionLinkId: order.subscriptionLinkId },
        select: { id: true, community: { select: { slug: true } } },
      });
      if (hasCommunity) {
        const communityTag = hasCommunity.community.slug.toUpperCase();
        const exists = await this.prisma.transaction.findFirst({
          where: { domPaymentId: order.domPixPaymentId },
          select: { id: true },
        });
        if (!exists) {
          const gross = Number(order.amountCharged);
          const pf = Number(order.platformFeeAmount);
          const communityTx = await this.prisma.transaction.create({
            data: {
              userId: order.userId,
              amount: gross,
              netAmount: gross - pf,
              status: TransactionStatus.COMPLETED,
              paymentMethod: PaymentMethod.PIX,
              totalFee: 0,
              acquirerFee: 0,
              platformFee: pf,
              ...transactionPlatformTagData(communityTag),
              description: `${order.subscriptionLink.name} [TENANT:${communityTag}] subOrder=${order.id}`,
              domPaymentId: order.domPixPaymentId,
              customerName: order.customerName,
              customerEmail: order.customerEmail,
              customerDocument: order.customerDocument,
              customerPhone: order.customerPhone ?? undefined,
              tracking: (order.tracking ?? undefined) as
                | Prisma.InputJsonValue
                | undefined,
            },
          });

          try {
            await this.prisma.$transaction((p) =>
              this.affiliateCommission.applyForTransaction(p, {
                transactionId: communityTx.id,
                referredUserId: order.userId,
                platformFee: communityTx.platformFee,
              }),
            );
          } catch (err: unknown) {
            this.logger.error(
              `[DomWebhook] Falha ao creditar comissão de afiliado (subOrder ${order.id}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }

    // Não atualizar webhookEventDbId aqui — o chamador (execute) fará isso
    return true;
  }

  private async sendPaymentLinkFilesToCustomer(tx: {
    id: string;
    paymentLinkId: string | null;
    customerEmail: string | null;
    customerName: string | null;
  }): Promise<void> {
    if (!tx.paymentLinkId || !tx.customerEmail || !this.emailService) return;

    try {
      const link = await this.prisma.paymentLink.findUnique({
        where: { id: tx.paymentLinkId },
        include: { files: true },
      });
      if (!link) return;
      const signed = await this.prisma.platformIntegration.findFirst({
        where: {
          key: 'WEBHOOK_SECRET',
          encryptedValue: { not: null },
          platform: { tag: { in: link.plataformas } },
        },
      });
      if (signed) return; // Durable platform outbox delivers e-mail and retries.

      // Pedido principal: produto + order bumps. Upsell/downsell: só o material da oferta.
      const delivery = await resolveLinkDelivery(this.prisma, tx.id, link);
      await sendLinkDelivery(
        {
          email: this.emailService,
          storage: this.storage,
          logger: this.logger,
        },
        {
          email: tx.customerEmail,
          name: tx.customerName,
          transactionId: tx.id,
        },
        delivery,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[DomWebhook] Falha ao enviar PDFs do link ${tx.paymentLinkId} para ${tx.customerEmail}: ${msg}`,
      );
    }
  }

  /**
   * Notifica o webhook externo configurado no link de pagamento avulso (ex: areaflix)
   * com purchase_approved / purchase_refunded.
   */
  private async notifyPaymentLinkExternalWebhook(
    tx: {
      id: string;
      paymentLinkId: string | null;
      customerEmail: string | null;
      customerName: string | null;
      customerDocument: string | null;
      customerPhone: string | null;
      amount: Prisma.Decimal;
      netAmount: Prisma.Decimal | null;
      paymentMethod: PaymentMethod;
    },
    event: 'purchase_approved' | 'purchase_refunded',
  ): Promise<void> {
    if (!tx.paymentLinkId) return;

    try {
      const link = await this.prisma.paymentLink.findUnique({
        where: { id: tx.paymentLinkId },
        include: { files: true },
      });
      if (!link?.webhookUrl) return;

      const signed = await this.prisma.platformIntegration.findFirst({
        where: {
          key: 'WEBHOOK_SECRET',
          encryptedValue: { not: null },
          platform: { tag: { in: link.plataformas } },
        },
      });
      if (signed) return; // Durable worker owns signed callbacks.
      const simpayToken = process.env.SIMPAY_WEBHOOK_TOKEN ?? '';
      // items: o que foi comprado nesta transação (principal + order bumps, ou só o upsell/downsell)
      const delivery = await resolveLinkDelivery(this.prisma, tx.id, link);
      await fetch(link.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-simpay-token': simpayToken,
        },
        body: JSON.stringify({
          event,
          customerEmail: tx.customerEmail,
          customerName: tx.customerName,
          // Pedido principal mantém o nome do link (plataformas mapeiam o plano por ele).
          planName: delivery.kind === 'OFFER' ? delivery.title : link.title,
          items: delivery.items,
          paymentMethod: String(tx.paymentMethod),
          amountCharged: Number(tx.amount),
          netAmount: Number(Number(tx.netAmount ?? tx.amount).toFixed(2)),
          orderId: tx.id,
          linkId: link.id,
          ...provisionDocPayload(tx.customerDocument ?? undefined),
          phone: tx.customerPhone ?? undefined,
        }),
      });
      this.logger.log(
        `[DomWebhook] Webhook externo (${event}) notificado para link ${link.id}, tx=${tx.id}`,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `[DomWebhook] Falha ao notificar webhook externo do link ${tx.paymentLinkId} (${event}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
