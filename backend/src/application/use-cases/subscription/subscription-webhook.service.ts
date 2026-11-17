import {
  alertUnresolvedWebhook,
  resolveOfferBySubscriptionReference,
} from '../../../modules/billing-core/webhook-offer-resolution';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TransactionStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { buildBillingTransactionDescription } from '../../helpers/billing-transaction-description.helper';

/**
 * DOM subscription postbacks (`POST subscription/webhook`). Offers settle through billing-core
 * (`ChargeReconciler`/`ChargeSettlement`); this service only records the charges of non-offer
 * `BillingContract`s (workspace and other billable resources) in the Simintpay ledger and
 * reports postbacks that match no contract, so they never fail silently.
 */
@Injectable()
export class SubscriptionWebhookService {
  private readonly logger = new Logger(SubscriptionWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async reportUnresolvedSubscription(
    handler: string,
    subscriberId: string,
  ): Promise<void> {
    const hit = await resolveOfferBySubscriptionReference(
      this.prisma,
      subscriberId,
    );
    if (hit) {
      this.logger.log(
        `[${handler}] ${subscriberId} resolvido na oferta ${hit.offerId ?? '-'} via ${hit.via}`,
      );
      return;
    }
    alertUnresolvedWebhook(
      this.logger,
      `subscription.${handler}`,
      subscriberId,
    );
  }

  private getString(v: unknown): string | null {
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return null;
  }

  async handleWebhook(payload: Record<string, unknown>): Promise<void> {
    const event = this.getString(payload.event);
    this.logger.log(`[SubscriptionWebhook] Received: ${event}`);

    switch (event) {
      case 'SIGNATURE-INVOICE-PAID':
      case 'SIGNATURE-CANCELLED':
        await this.reportUnresolvedByPayload(event, payload);
        break;
      case 'CHARGE-APPROVED':
        await this.handleChargeApproved(payload);
        break;
      case 'SIGNATURE-CREATED':
      case 'SIGNATURE-INVOICE-CREATED':
        this.logger.log(`[SubscriptionWebhook] ${event} acknowledged`);
        break;
      default:
        this.logger.warn(`[SubscriptionWebhook] Unhandled event: ${event}`);
    }
  }

  /** Invoice/cancel events of offers are handled by billing-core; just alert when nothing matches. */
  private async reportUnresolvedByPayload(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const data = payload.data as Record<string, unknown> | undefined;
    const relations = data?.relations as Record<string, unknown> | undefined;
    const subscriberId = this.getString(relations?.id_subscriber);
    if (!subscriberId) {
      this.logger.warn(`[${event}] Sem id_subscriber, ignorando.`);
      return;
    }
    const contract = await this.prisma.billingContract.findUnique({
      where: { externalSubscriptionId: subscriberId },
      select: { id: true },
    });
    if (!contract) await this.reportUnresolvedSubscription(event, subscriberId);
  }

  private async handleChargeApproved(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const data = payload.data as Record<string, unknown> | undefined;
    if (!data) return;

    const domTransactionId = this.getString(data.id);
    if (!domTransactionId) {
      this.logger.warn(
        '[handleChargeApproved] CHARGE-APPROVED sem data.id, ignorando.',
      );
      return;
    }

    const exists = await this.prisma.transaction.findFirst({
      where: { domPaymentId: domTransactionId },
      select: { id: true },
    });
    if (exists) {
      this.logger.warn(
        `[handleChargeApproved] Transação ${domTransactionId} já existe, ignorando.`,
      );
      return;
    }

    const chargeStatus = this.getString(data.status);
    const relations = data.relations as Record<string, unknown> | undefined;
    const subscriberId = this.getString(relations?.id_subscriber);
    if (!subscriberId) {
      this.logger.warn(
        '[handleChargeApproved] CHARGE-APPROVED sem id_subscriber, ignorando.',
      );
      return;
    }

    if (
      chargeStatus === 'not_authorized' ||
      chargeStatus === 'failed' ||
      chargeStatus === 'expired'
    ) {
      this.logger.warn(
        `[handleChargeApproved] Pagamento negado (${chargeStatus}) para ${subscriberId}`,
      );
      return;
    }

    const rawAmount = typeof data.amount === 'number' ? data.amount : 0;
    const amount = new Prisma.Decimal(rawAmount).div(100);
    const feeDetails = data.fee_details as Record<string, unknown> | undefined;
    const domFeeRaw =
      typeof feeDetails?.amount === 'number' ? feeDetails.amount : 0;
    const domFee = new Prisma.Decimal(domFeeRaw).div(100);

    const recorded = await this.recordBillingContractCharge({
      subscriberId,
      domPaymentId: domTransactionId,
      chargeStatus,
      amount,
      domFee,
      data,
    });
    if (!recorded)
      await this.reportUnresolvedSubscription(
        'handleChargeApproved',
        subscriberId,
      );
  }

  /**
   * Workspace e outros recursos faturáveis não são SubscriptionLinks. Mantemos
   * cada cobrança recorrente no ledger próprio da Simintpay, sem crédito de
   * carteira e sem depender de descrição ou de identificadores específicos da DOM.
   */
  private async recordBillingContractCharge(input: {
    subscriberId: string;
    domPaymentId: string;
    chargeStatus: string | null;
    amount: Prisma.Decimal;
    domFee: Prisma.Decimal;
    data: Record<string, unknown>;
  }): Promise<boolean> {
    const contract = await this.prisma.billingContract.findUnique({
      where: { externalSubscriptionId: input.subscriberId },
      select: {
        userId: true,
        baseAmount: true,
        description: true,
        metadata: true,
        quantity: true,
        unitAmount: true,
      },
    });
    if (!contract) return false;

    const status = [
      'not_authorized',
      'failed',
      'expired',
      'refused',
      'error',
    ].includes((input.chargeStatus ?? '').toLowerCase())
      ? TransactionStatus.FAILED
      : TransactionStatus.COMPLETED;
    const amount = input.amount.isPositive()
      ? input.amount
      : new Prisma.Decimal(contract.baseAmount).plus(
          new Prisma.Decimal(contract.unitAmount).times(contract.quantity),
        );
    const description = buildBillingTransactionDescription(
      contract.description,
      contract.metadata,
    );
    const existing = await this.prisma.transaction.findFirst({
      where: { domPaymentId: input.domPaymentId },
      select: { id: true, status: true },
    });
    const initialAttempt = existing
      ? null
      : await this.prisma.transaction.findFirst({
          where: {
            externalPaymentId: input.subscriberId,
            domPaymentId: null,
            status: {
              in: [
                TransactionStatus.PENDING,
                TransactionStatus.COMPLETED,
                TransactionStatus.FAILED,
              ],
            },
          },
          select: { id: true, status: true },
        });
    const customer = input.data.customer as Record<string, unknown> | undefined;
    const values = {
      amount,
      netAmount: amount.sub(input.domFee),
      status,
      paymentMethod: PaymentMethod.CREDIT_CARD,
      totalFee: input.domFee,
      acquirerFee: input.domFee,
      platformFee: new Prisma.Decimal(0),
      description,
      customerName:
        this.getString(customer?.name) ??
        this.getString(input.data.customer_name),
      customerEmail:
        this.getString(customer?.email) ??
        this.getString(input.data.customer_email),
      customerDocument:
        this.getString(customer?.document) ??
        this.getString(input.data.customer_document),
      customerPhone:
        this.getString(customer?.phone) ??
        this.getString(input.data.customer_phone),
      updatedAt: new Date(),
    };
    const matchingTransaction = existing ?? initialAttempt;
    if (matchingTransaction) {
      await this.prisma.transaction.update({
        where: { id: matchingTransaction.id },
        data: {
          ...values,
          previousStatus: matchingTransaction.status,
          domPaymentId: input.domPaymentId,
        },
      });
      return true;
    }
    await this.prisma.transaction.create({
      data: {
        userId: contract.userId,
        ...values,
        domPaymentId: input.domPaymentId,
        externalPaymentId: input.domPaymentId,
      },
    });
    return true;
  }
}
