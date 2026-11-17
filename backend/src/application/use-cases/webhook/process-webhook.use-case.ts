import { alertUnresolvedWebhook } from '../../../modules/billing-core/webhook-offer-resolution';
import { settleEbookPayment } from '../../../modules/platform-core/ebook-settlement';
import {
  creditedSettlementAmount,
  bindLinkPayment,
  linkChargeReference,
  settleFinalNet,
} from '../../../modules/platform-core/link-settlement';
import { markChargeSettled } from '../../../modules/billing-core/charge-settlement';
import { CheckoutEventsService } from '../../services/checkout-events.service';
import { notifyZeroGrauPaymentStatus } from '../../../modules/zero-grau/services/zero-grau-webhook-notifier';
import { PlatformEventsService } from '../../../modules/platform-core/platform-events.service';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, TransactionStatus } from '@prisma/client';
import { TRANSACTION_REPOSITORY } from '../../../core/repositories/transaction.repository.interface';
import { WEBHOOK_EVENT_REPOSITORY } from '../../../core/repositories/webhook-event.repository.interface';
import { BALANCE_LOG_REPOSITORY } from '../../../core/repositories/balance-log.repository.interface';
import { applyWalletEntry } from '../../../modules/wallet-ledger/wallet-ledger';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaEventsService } from '../../../modules/renovada/events/renovada-events.service';
import { EmailService } from '../../../infrastructure/email/email.service';
import { platformTaxaTagForTransaction } from '../../helpers/dom-fee-estimate.helper';
import {
  getPlatformTaxaEffective,
  canonicalPlatformTaxaTag,
} from '../../../modules/platform-taxas/platform-taxas.store';
import {
  PLATFORM_TAXA_DEFAULTS,
  LEGACY_DOM_CASHBACK_REAIS,
} from '../../../modules/platform-taxas/platform-taxas.keys';
import { AffiliateCommissionService } from '../../services/affiliate-commission.service';

import type { ITransactionRepository } from '../../../core/repositories/transaction.repository.interface';
import type { IWebhookEventRepository } from '../../../core/repositories/webhook-event.repository.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';

type WebhookPayload = Record<string, unknown>;

type DomWebhookPayload = {
  event: string;
  signature: string;
  data: {
    paymentId: string;
    status: string;
    amountWithoutAllFee: number;
    amount?: number;
    payment_method?: string;
    description?: string;
    installments?: number;
    customer?: {
      name?: string;
      email?: string;
      document?: string;
      mobile_phone?: string;
    };
    [k: string]: unknown;
  };
};

@Injectable()
export class ProcessWebhookUseCase {
  private readonly logger = new Logger(ProcessWebhookUseCase.name);

  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly events: IWebhookEventRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactions: ITransactionRepository,
    @Inject(BALANCE_LOG_REPOSITORY)
    private readonly balanceLogs: IBalanceLogRepository,
    private readonly prisma: PrismaService,
    private readonly renovadaEvents: RenovadaEventsService,
    private readonly affiliateCommission: AffiliateCommissionService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly platformEvents?: PlatformEventsService,
    @Optional() private readonly checkoutEvents?: CheckoutEventsService,
  ) {}

  private getObject(v: unknown): Record<string, unknown> | null {
    if (v && typeof v === 'object' && !Array.isArray(v))
      return v as Record<string, unknown>;
    return null;
  }

  private getString(v: unknown): string | null {
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return null;
  }

  private toDecimal(value: unknown): Prisma.Decimal {
    if (value instanceof Prisma.Decimal) return value;
    if (typeof value === 'number') return new Prisma.Decimal(value);
    if (typeof value === 'string') return new Prisma.Decimal(value);
    return new Prisma.Decimal(0);
  }

  private parseDomPayload(payload: WebhookPayload): DomWebhookPayload | null {
    const root = this.getObject(payload);
    if (!root) return null;

    const event = this.getString(root.event);
    const signature = this.getString(root.signature);
    const data = this.getObject(root.data);
    if (!event || !signature || !data) return null;

    const paymentId = this.getString(data.paymentId);
    const status = this.getString(data.status);
    const amountWithoutAllFeeRaw = data.amountWithoutAllFee;

    if (!paymentId || !status) return null;

    const amountWithoutAllFee =
      typeof amountWithoutAllFeeRaw === 'number'
        ? amountWithoutAllFeeRaw
        : typeof amountWithoutAllFeeRaw === 'string'
          ? Number(amountWithoutAllFeeRaw)
          : NaN;

    if (!Number.isFinite(amountWithoutAllFee)) return null;

    return {
      event,
      signature,
      data: {
        paymentId,
        status,
        amountWithoutAllFee,
        ...data,
      },
    };
  }

  private mapDomStatusToTransactionStatus(
    status: string,
  ): TransactionStatus | null {
    switch (status) {
      case 'paid':
        return TransactionStatus.COMPLETED;
      case 'refunded':
        return TransactionStatus.REFUNDED;
      case 'chargeback':
        return TransactionStatus.CHARGEBACK;
      case 'failed':
        return TransactionStatus.FAILED;
      case 'expired':
        return TransactionStatus.EXPIRED;
      case 'in_mediation':
        return TransactionStatus.IN_MEDIATION;
      case 'pending_refund':
        return TransactionStatus.PENDING_REFUND;
      default:
        return null;
    }
  }

  private isValidTransition(
    from: TransactionStatus,
    to: TransactionStatus,
  ): boolean {
    const allowed: Record<TransactionStatus, TransactionStatus[]> = {
      [TransactionStatus.DRAFT]: [
        TransactionStatus.PENDING,
        TransactionStatus.COMPLETED,
        TransactionStatus.FAILED,
        TransactionStatus.EXPIRED,
      ],
      [TransactionStatus.PENDING]: [
        TransactionStatus.COMPLETED,
        TransactionStatus.FAILED,
        TransactionStatus.EXPIRED,
      ],
      [TransactionStatus.COMPLETED]: [
        TransactionStatus.REFUNDED,
        TransactionStatus.CHARGEBACK,
        TransactionStatus.IN_MEDIATION,
      ],
      [TransactionStatus.IN_MEDIATION]: [
        TransactionStatus.CHARGEBACK,
        TransactionStatus.COMPLETED,
        TransactionStatus.REFUNDED,
      ],
      [TransactionStatus.FAILED]: [],
      [TransactionStatus.EXPIRED]: [],
      [TransactionStatus.REFUNDED]: [],
      [TransactionStatus.CHARGEBACK]: [],
      [TransactionStatus.PENDING_REFUND]: [],
    };

    return allowed[from]?.includes(to) ?? false;
  }

  async execute(input: {
    payload: WebhookPayload;
    transactionId?: string;
  }): Promise<void> {
    const parsed = this.parseDomPayload(input.payload);
    if (!parsed) {
      return;
    }

    const eventId = parsed.signature;

    const exists = await this.events.findByEventId(eventId);
    if (exists?.status === 'PROCESSED') {
      return;
    }

    const eventType = parsed.event;

    const event =
      exists ??
      (await this.events.create({
        eventId,
        source: 'api-dom',
        eventType,
        payload: input.payload,
      }));

    try {
      const domPaymentId = parsed.data.paymentId;

      const reference =
        input.transactionId ?? linkChargeReference(parsed.data.description);
      const trx = reference
        ? await this.prisma.transaction.findUnique({ where: { id: reference } })
        : await this.transactions.findByDomPaymentId(domPaymentId);

      if (!trx) {
        this.logger.log(
          `[WEBHOOK] Transaction ${domPaymentId} not found, ignoring because we cannot determine the tenant user.`,
        );
        alertUnresolvedWebhook(this.logger, 'webhook.payment', domPaymentId);
        return;
      }

      if (trx.settlementBasis === 'EBOOK_V1') {
        const handled = await settleEbookPayment(
          this.prisma,
          domPaymentId,
          parsed.data.status,
          trx.id,
        );
        if (!handled) throw new Error('EBOOK_ENROLLMENT_BINDING_REQUIRED');
        await this.events.markProcessed(event.id);
        return;
      }
      const t = trx;

      const nextStatus = this.mapDomStatusToTransactionStatus(
        parsed.data.status,
      );
      if (!nextStatus) {
        await this.events.markFailed(
          event.id,
          `unsupported status=${parsed.data.status}`,
        );
        return;
      }

      if (!this.isValidTransition(t.status, nextStatus)) {
        await this.events.markFailed(
          event.id,
          `invalid status transition ${t.status} -> ${nextStatus}`,
        );
        return;
      }

      const amountWithoutAllFee = this.toDecimal(
        parsed.data.amountWithoutAllFee,
      );

      let creditAmount: Prisma.Decimal;
      if (
        t.settlementBasis === 'FINAL_NET' ||
        (/^[a-f0-9]{64}$/.test(t.id) && t.netAmount != null)
      )
        creditAmount = new Prisma.Decimal(t.netAmount!);
      else {
        // Legacy entries retain their characterized pre-fixed-fee contract.
        const user = await this.prisma.user.findUnique({
          where: { id: t.userId },
          select: { platform: { select: { tag: true } } },
        });
        const tenantSlug = user?.platform?.tag?.toUpperCase() ?? 'GLOBAL';
        const rowTag = platformTaxaTagForTransaction(t);
        const feeTag =
          rowTag !== 'GLOBAL' ? rowTag : canonicalPlatformTaxaTag(tenantSlug);
        const fixedTx = getPlatformTaxaEffective(
          feeTag,
          'TAXA_FIXA_TRANSACAO',
          PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
        );
        const fixedCashback = LEGACY_DOM_CASHBACK_REAIS;
        creditAmount = amountWithoutAllFee.sub(
          new Prisma.Decimal(fixedTx + fixedCashback),
        );
      }

      const status = parsed.data.status;

      const applied = await this.prisma.$transaction(async (p) => {
        if (t.settlementBasis === 'FINAL_NET') {
          await bindLinkPayment(p, t, domPaymentId);
          const settled = await settleFinalNet(p, t, nextStatus, 'WEBHOOK');
          if (settled) await markChargeSettled(p, t.id, nextStatus);
          return settled;
        }
        if (
          t.status === TransactionStatus.COMPLETED &&
          ['refunded', 'chargeback', 'in_mediation'].includes(status)
        )
          creditAmount = await creditedSettlementAmount(p, t.id, creditAmount);
        const claimed = await p.transaction.updateMany({
          where: { id: t.id, status: t.status },
          data: { previousStatus: t.status, status: nextStatus },
        });
        if (claimed.count !== 1) return false;
        const shouldMutateWallet = [
          'paid',
          'refunded',
          'chargeback',
          'in_mediation',
        ].includes(status);

        let balanceDelta = new Prisma.Decimal(0);
        let lockedDelta = new Prisma.Decimal(0);
        if (shouldMutateWallet) {
          const wallet = await p.wallet.findUnique({
            where: { userId: t.userId },
          });
          if (!wallet) throw new Error('wallet not found');

          if (status === 'paid') {
            balanceDelta = creditAmount;
          } else if (status === 'refunded' || status === 'chargeback') {
            balanceDelta = creditAmount.neg();
          } else if (status === 'in_mediation') {
            balanceDelta = creditAmount.neg();
            lockedDelta = creditAmount;
          }
        }

        await p.transactionStatusHistory.create({
          data: {
            transactionId: t.id,
            fromStatus: t.status,
            toStatus: nextStatus,
            metadata: { reason: `webhook: ${eventType}` },
          },
        });

        if (shouldMutateWallet) {
          await applyWalletEntry(p, {
            userId: t.userId,
            action: `WEBHOOK_${eventType}`,
            transactionId: t.id,
            balanceDelta,
            lockedDelta,
            source: 'WEBHOOK',
            metadata: input.payload as never,
          });
        }

        if (nextStatus === TransactionStatus.COMPLETED) {
          await this.affiliateCommission.applyForTransaction(p, {
            transactionId: t.id,
            referredUserId: t.userId,
            platformFee: t.platformFee,
          });
        } else if (
          nextStatus === TransactionStatus.REFUNDED ||
          nextStatus === TransactionStatus.CHARGEBACK
        ) {
          await this.affiliateCommission.reverseForTransaction(p, t.id);
        }
        return true;
      });

      await this.events.markProcessed(event.id);
      if (!applied) return;

      // EMIT EVENT for Real-Time UI (Renovada)
      const eventTag = platformTaxaTagForTransaction(t);
      if (eventTag === 'ZERO-GRAU') {
        const outcome = await notifyZeroGrauPaymentStatus({
          paymentId: domPaymentId,
          status: nextStatus,
        });
        if (outcome === 'failed')
          this.logger.warn(`Callback Zero Grau pendente para ${t.id}`);
      }
      if (
        t.domPaymentId &&
        ['COMPLETED', 'FAILED', 'EXPIRED'].includes(nextStatus)
      )
        this.checkoutEvents?.emit({
          domPaymentId: t.domPaymentId,
          status: nextStatus as 'COMPLETED' | 'FAILED' | 'EXPIRED',
        });
      if (this.platformEvents && eventTag !== 'GLOBAL')
        this.platformEvents.emit(eventTag, 'transaction', {
          ...t,
          status: nextStatus,
        });
      else if (eventTag === 'RENOVADA')
        this.renovadaEvents.emitTransaction({ ...t, status: nextStatus });
    } catch (e: unknown) {
      this.logger.error(
        `Error processing webhook ${event.id}: ${e instanceof Error ? e.message : 'unknown error'}`,
      );
      await this.events.markFailed(
        event.id,
        e instanceof Error ? e.message : 'unknown error',
      );
      throw e;
    }
  }
}
