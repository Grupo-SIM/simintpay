import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { TRANSACTION_REPOSITORY } from '../../../core/repositories/transaction.repository.interface';
import { WEBHOOK_EVENT_REPOSITORY } from '../../../core/repositories/webhook-event.repository.interface';
import { BALANCE_LOG_REPOSITORY } from '../../../core/repositories/balance-log.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaEventsService } from '../../../modules/renovada/events/renovada-events.service';
import { PixPlanService } from '../pix-plan/pix-plan.service';
import { PixPlanEventsService } from '../../services/pix-plan-events.service';
import { CommunityManagementService } from '../../services/community-management.service';
import { EmailService } from '../../../infrastructure/email/email.service';
import { TENANT_AREAFLIX_TAG } from '../../utils/internal-tags.util';
import { platformTaxaTagFromText } from '../../helpers/dom-fee-estimate.helper';
import { getPlatformTaxaEffective, canonicalPlatformTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { AffiliateCommissionService } from '../../services/affiliate-commission.service';

import type { ITransactionRepository } from '../../../core/repositories/transaction.repository.interface';
import type { IWebhookEventRepository } from '../../../core/repositories/webhook-event.repository.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';

function documentType(raw: string | null | undefined): 'CPF' | 'CNPJ' {
  return (raw ?? '').replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF';
}

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
    @Optional() private readonly pixPlanService?: PixPlanService,
    @Optional() private readonly pixPlanEvents?: PixPlanEventsService,
    @Optional() private readonly communities?: CommunityManagementService,
    @Optional() private readonly emailService?: EmailService,
  ) { }

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
      [TransactionStatus.DRAFT]: [TransactionStatus.PENDING],
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

  async execute(input: { payload: WebhookPayload }): Promise<void> {
    const parsed = this.parseDomPayload(input.payload);
    if (!parsed) {
      return;
    }

    const eventId = parsed.signature;

    const exists = await this.events.findByEventId(eventId);
    if (exists) {
      return;
    }

    const eventType = parsed.event;

    const event = await this.events.create({
      eventId,
      source: 'api-dom',
      eventType,
      payload: input.payload,
    });

    try {
      const domPaymentId = parsed.data.paymentId;

      let trx = await this.transactions.findByDomPaymentId(domPaymentId);

      if (!trx) {
        // Check if this is a subscription link PIX payment
        const handled = await this.handleSubscriptionLinkPix(domPaymentId, parsed.data.status, event.id);
        if (handled) return;

        this.logger.log(`[WEBHOOK] Transaction ${domPaymentId} not found, ignoring because we cannot determine the tenant user.`);
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

      // Determina a plataforma da transação para calcular taxas fixas corretas.
      // Renovada e Bosque são isentos (taxaFixa=0, taxaCashback=0); demais pagam R$4.
      const user = await this.prisma.user.findUnique({
        where: { id: t.userId },
        select: { tenantModule: { select: { slug: true } } },
      });
      const tenantSlug = user?.tenantModule?.slug?.toUpperCase() ?? 'GLOBAL';
      const rowTag = platformTaxaTagFromText(t.description ?? undefined);
      const feeTag = rowTag !== 'GLOBAL' ? rowTag : canonicalPlatformTaxaTag(tenantSlug);
      const fixedTx = getPlatformTaxaEffective(feeTag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
      const fixedCashback = getPlatformTaxaEffective(feeTag, 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
      const creditAmount = amountWithoutAllFee.sub(new Prisma.Decimal(fixedTx + fixedCashback));

      const status = parsed.data.status;

      await this.prisma.$transaction(async (p) => {
        const walletUpdates: {
          balance?: Prisma.Decimal;
          lockedBalance?: Prisma.Decimal;
        } = {};

        let walletBeforeBalance: Prisma.Decimal | null = null;
        let walletBeforeLocked: Prisma.Decimal | null = null;
        let walletAfterBalance: Prisma.Decimal | null = null;
        let walletAfterLocked: Prisma.Decimal | null = null;

        const shouldMutateWallet = [
          'paid',
          'refunded',
          'chargeback',
          'in_mediation',
        ].includes(status);

        if (shouldMutateWallet) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const wallet = await p.wallet.findUnique({
              where: { userId: t.userId },
            });
            if (!wallet) throw new Error('wallet not found');

            const balanceBefore = wallet.balance;
            const lockedBefore = wallet.lockedBalance;

            walletBeforeBalance ??= balanceBefore;
            walletBeforeLocked ??= lockedBefore;

            let balanceAfter = balanceBefore;
            let lockedAfter = lockedBefore;

            if (status === 'paid') {
              balanceAfter = balanceBefore.add(creditAmount);
            } else if (status === 'refunded' || status === 'chargeback') {
              balanceAfter = balanceBefore.sub(creditAmount);
            } else if (status === 'in_mediation') {
              balanceAfter = balanceBefore.sub(creditAmount);
              lockedAfter = lockedBefore.add(creditAmount);
            }

            walletUpdates.balance = balanceAfter;
            walletUpdates.lockedBalance = lockedAfter;

            const result = await p.wallet.updateMany({
              where: { id: wallet.id, version: wallet.version },
              data: {
                balance: balanceAfter,
                lockedBalance: lockedAfter,
                version: { increment: 1 },
              },
            });

            if (result.count > 0) {
              walletAfterBalance = balanceAfter;
              walletAfterLocked = lockedAfter;
              break;
            }

            if (attempt === 2) {
              throw new Error('Wallet version conflict after 3 retries');
            }
          }
        }

        await p.transaction.update({
          where: { id: t.id },
          data: { previousStatus: t.status, status: nextStatus },
        });

        await p.transactionStatusHistory.create({
          data: {
            transactionId: t.id,
            fromStatus: t.status,
            toStatus: nextStatus,
            metadata: { reason: `webhook: ${eventType}` },
          },
        });

        if (
          shouldMutateWallet &&
          walletBeforeBalance &&
          walletBeforeLocked &&
          walletAfterBalance &&
          walletAfterLocked
        ) {
          await p.balanceLog.create({
            data: {
              userId: t.userId,
              action: `WEBHOOK_${eventType}`,
              transactionId: t.id,
              amount: creditAmount,
              balanceBefore: walletBeforeBalance,
              balanceAfter: walletAfterBalance,
              lockedBefore: walletBeforeLocked,
              lockedAfter: walletAfterLocked,
              source: 'WEBHOOK',
              metadata: input.payload as never,
            },
          });
        }

        if (nextStatus === TransactionStatus.COMPLETED) {
          await this.affiliateCommission.applyForTransaction(p, {
            transactionId: t.id,
            referredUserId: t.userId,
            platformFee: t.platformFee,
          });
        } else if (nextStatus === TransactionStatus.REFUNDED || nextStatus === TransactionStatus.CHARGEBACK) {
          await this.affiliateCommission.reverseForTransaction(p, t.id);
        }
      });

      await this.events.markProcessed(event.id);

      // SSE: notificar checkout em tempo real (payment link, PIX plan, etc.)
      if (nextStatus === TransactionStatus.COMPLETED) {
        this.pixPlanEvents?.emit({ transactionId: t.id, status: 'COMPLETED' });
      }

      // PIX-PLAN: creditar dias se a transação tiver um PixPlanOrder
      if (nextStatus === TransactionStatus.COMPLETED && this.pixPlanService) {
        try {
          const customer = parsed.data.customer;
          await this.pixPlanService.handlePixPlanWebhook(t.id, {
            name: customer?.name ?? '',
            email: customer?.email ?? '',
            document: customer?.document ?? '',
            document_type: documentType(customer?.document),
            mobile_phone: customer?.mobile_phone,
          });
        } catch (pixPlanError: any) {
          this.logger.error(`Erro ao processar PIX-PLAN para tx ${t.id}: ${pixPlanError.message}`);
        }
      }

      // EMIT EVENT for Real-Time UI (Renovada)
      if (t.userId === 'ba2b57d6-e3bf-4395-af31-58454f27207a') {
        this.renovadaEvents.emitTransaction(t);
      }
    } catch (e: unknown) {
      this.logger.error(`Error processing webhook ${event.id}: ${e instanceof Error ? e.message : 'unknown error'}`);
      await this.events.markFailed(
        event.id,
        e instanceof Error ? e.message : 'unknown error',
      );
    }
  }

  private async handleSubscriptionLinkPix(
    domPixPaymentId: string,
    domStatus: string,
    eventId: string,
  ): Promise<boolean> {
    const order = await this.prisma.subscriptionLinkOrder.findFirst({
      where: { domPixPaymentId },
      include: {
        subscriptionLink: true,
      },
    });

    if (!order) return false;

    this.logger.log(`[WEBHOOK] Found SubscriptionLinkOrder ${order.id} for domPixPaymentId ${domPixPaymentId}, status=${domStatus}`);

    if (domStatus !== 'paid') {
      // Update order status for other statuses (expired, failed, etc.)
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
      await this.events.markProcessed(eventId);
      return true;
    }

    // Already processed
    if (order.status === 'paid') {
      await this.events.markProcessed(eventId);
      return true;
    }

    // Mark order as paid
    await this.prisma.subscriptionLinkOrder.update({
      where: { id: order.id },
      data: { status: 'paid' },
    });

    // Activate community access
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
          this.logger.log(`[WEBHOOK] Community access activated for order ${order.id}`);
        }
      } catch (err: unknown) {
        this.logger.error(`[WEBHOOK] Error activating community for order ${order.id}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    // Send access email
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
        this.logger.log(`[WEBHOOK] Access email sent to ${order.customerEmail} for order ${order.id}`);
      } catch (err: unknown) {
        this.logger.error(`[WEBHOOK] Error sending email for order ${order.id}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    const whAf = (order.subscriptionLink.webhookUrl ?? '').toLowerCase();
    if (whAf.includes('areaflix') && order.domPixPaymentId) {
      const exists = await this.prisma.transaction.findFirst({
        where: { domPaymentId: order.domPixPaymentId },
        select: { id: true },
      });
      if (!exists) {
        const gross = Number(order.amountCharged);
        const pf = Number(order.platformFeeAmount);
        const areaflixTx = await this.prisma.transaction.create({
          data: {
            userId: order.userId,
            amount: gross,
            netAmount: gross - pf,
            status: TransactionStatus.COMPLETED,
            paymentMethod: PaymentMethod.PIX,
            totalFee: 0,
            domFee: 0,
            platformFee: pf,
            description: `${order.subscriptionLink.name} ${TENANT_AREAFLIX_TAG} subOrder=${order.id}`,
            domPaymentId: order.domPixPaymentId,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerDocument: order.customerDocument,
            customerPhone: order.customerPhone ?? undefined,
          },
        });

        try {
          await this.prisma.$transaction((p) =>
            this.affiliateCommission.applyForTransaction(p, {
              transactionId: areaflixTx.id,
              referredUserId: order.userId,
              platformFee: areaflixTx.platformFee,
            }),
          );
        } catch (err: unknown) {
          this.logger.error(
            `[WEBHOOK] Falha ao creditar comissão de afiliado (subOrder ${order.id}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else if (order.domPixPaymentId) {
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
              domFee: 0,
              platformFee: pf,
              description: `${order.subscriptionLink.name} [TENANT:${communityTag}] subOrder=${order.id}`,
              domPaymentId: order.domPixPaymentId,
              customerName: order.customerName,
              customerEmail: order.customerEmail,
              customerDocument: order.customerDocument,
              customerPhone: order.customerPhone ?? undefined,
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
              `[WEBHOOK] Falha ao creditar comissão de afiliado (subOrder ${order.id}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }

    await this.events.markProcessed(eventId);
    return true;
  }
}
