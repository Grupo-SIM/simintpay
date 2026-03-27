import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, TransactionStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  BALANCE_LOG_REPOSITORY,
} from '../../../core/repositories/balance-log.repository.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';

@Injectable()
export class SubscriptionWebhookService {
  private readonly logger = new Logger(SubscriptionWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BALANCE_LOG_REPOSITORY)
    private readonly balanceLogs: IBalanceLogRepository,
  ) {}

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
        await this.handleInvoicePaid(payload);
        break;
      case 'CHARGE-APPROVED':
        await this.handleChargeApproved(payload);
        break;
      case 'SIGNATURE-CANCELLED':
        await this.handleCancelled(payload);
        break;
      case 'SIGNATURE-CREATED':
        this.logger.log('[SubscriptionWebhook] SIGNATURE-CREATED acknowledged');
        break;
      case 'SIGNATURE-INVOICE-CREATED':
        this.logger.log('[SubscriptionWebhook] SIGNATURE-INVOICE-CREATED acknowledged');
        break;
      default:
        this.logger.warn(`[SubscriptionWebhook] Unhandled event: ${event}`);
    }
  }

  private async handleInvoicePaid(payload: Record<string, unknown>): Promise<void> {
    const data = payload.data as Record<string, unknown> | undefined;
    if (!data) return;

    const transactions = data.transactions as Array<Record<string, unknown>> | undefined;
    const tx = transactions?.[0];
    if (!tx) {
      this.logger.warn('[handleInvoicePaid] SIGNATURE-INVOICE-PAID sem transactions, ignorando.');
      return;
    }

    const rawAmount = typeof tx.amount === 'number' ? tx.amount : 0;
    const amount = new Prisma.Decimal(rawAmount).div(100);

    const feeDetails = tx.fee_details as Record<string, unknown> | undefined;
    const domFeeRaw = typeof feeDetails?.amount === 'number' ? feeDetails.amount : 0;
    const domFee = new Prisma.Decimal(domFeeRaw).div(100);

    const netAmount = amount.sub(domFee);

    const relations = data.relations as Record<string, unknown> | undefined;
    const subscriberId = this.getString(relations?.id_subscriber);
    if (!subscriberId) {
      this.logger.warn('[handleInvoicePaid] Sem id_subscriber, ignorando.');
      return;
    }

    const domTransactionId = this.getString(tx.id);
    if (domTransactionId) {
      const exists = await this.prisma.transaction.findFirst({
        where: { domPaymentId: domTransactionId },
        select: { id: true },
      });
      if (exists) {
        this.logger.warn(`[handleInvoicePaid] Transação ${domTransactionId} já existe, ignorando.`);
        return;
      }
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { domSubscriptionId: subscriberId },
      include: {
        customer: true,
        plan: true,
        user: { include: { wallet: true } },
      },
    });
    if (!subscription) {
      this.logger.warn(`[handleInvoicePaid] Subscription não encontrada para ${subscriberId}`);
      return;
    }

    await this.createTransactionAndCreditWallet({
      subscription,
      amount,
      netAmount,
      domFee,
      domPaymentId: domTransactionId,
      description: this.getString(data.description) ?? subscription.plan?.name ?? '-',
    });
  }

  private async handleChargeApproved(payload: Record<string, unknown>): Promise<void> {
    const data = payload.data as Record<string, unknown> | undefined;
    if (!data) return;

    const domTransactionId = this.getString(data.id);
    if (!domTransactionId) {
      this.logger.warn('[handleChargeApproved] CHARGE-APPROVED sem data.id, ignorando.');
      return;
    }

    const exists = await this.prisma.transaction.findFirst({
      where: { domPaymentId: domTransactionId },
      select: { id: true },
    });
    if (exists) {
      this.logger.warn(`[handleChargeApproved] Transação ${domTransactionId} já existe, ignorando.`);
      return;
    }

    const chargeStatus = this.getString(data.status);
    const relations = data.relations as Record<string, unknown> | undefined;
    const subscriberId = this.getString(relations?.id_subscriber);
    if (!subscriberId) {
      this.logger.warn('[handleChargeApproved] CHARGE-APPROVED sem id_subscriber, ignorando.');
      return;
    }

    if (chargeStatus === 'not_authorized' || chargeStatus === 'failed' || chargeStatus === 'expired') {
      const failedSub = await this.prisma.subscription.findFirst({
        where: { domSubscriptionId: subscriberId },
        select: { id: true },
      });
      if (failedSub) {
        await this.prisma.subscription.update({
          where: { id: failedSub.id },
          data: { status: 'inactive' },
        });
        this.logger.warn(`[handleChargeApproved] Pagamento negado (${chargeStatus}), subscription ${failedSub.id} -> inactive`);
      }
      return;
    }

    const rawAmount = typeof data.amount === 'number' ? data.amount : 0;
    const amount = new Prisma.Decimal(rawAmount).div(100);
    const feeDetails = data.fee_details as Record<string, unknown> | undefined;
    const domFeeRaw = typeof feeDetails?.amount === 'number' ? feeDetails.amount : 0;
    const domFee = new Prisma.Decimal(domFeeRaw).div(100);
    const netAmount = amount.sub(domFee);

    const subscription = await this.prisma.subscription.findFirst({
      where: { domSubscriptionId: subscriberId },
      include: {
        customer: true,
        plan: true,
        user: { include: { wallet: true } },
      },
    });
    if (!subscription) {
      this.logger.warn(`[handleChargeApproved] Subscription não encontrada para ${subscriberId}`);
      return;
    }

    await this.createTransactionAndCreditWallet({
      subscription,
      amount,
      netAmount,
      domFee,
      domPaymentId: domTransactionId,
      description: this.getString(data.product_first) ?? this.getString(data.description) ?? subscription.plan?.name ?? '-',
    });
  }

  private async handleCancelled(payload: Record<string, unknown>): Promise<void> {
    const data = payload.data as Record<string, unknown> | undefined;
    if (!data) return;

    const relations = data.relations as Record<string, unknown> | undefined;
    const subscriberId = this.getString(relations?.id_subscriber);
    if (!subscriberId) {
      this.logger.warn('[handleCancelled] Sem id_subscriber, ignorando.');
      return;
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { domSubscriptionId: subscriberId },
      select: { id: true },
    });
    if (!subscription) {
      this.logger.warn(`[handleCancelled] Subscription não encontrada para ${subscriberId}`);
      return;
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'cancelled' },
    });
    this.logger.log(`[handleCancelled] Subscription ${subscription.id} cancelada`);
  }

  private async createTransactionAndCreditWallet(input: {
    subscription: {
      id: string;
      userId: string;
      customer: { name: string; email: string; document: string; phone?: string | null } | null;
      plan: { name: string; webhookUrl?: string | null } | null;
      user: { wallet: { id: string; userId: string; balance: Prisma.Decimal; lockedBalance: Prisma.Decimal; version: number } | null };
    };
    amount: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    domFee: Prisma.Decimal;
    domPaymentId: string | null;
    description: string;
  }): Promise<void> {
    const { subscription, amount, netAmount, domFee, domPaymentId, description } = input;

    if (!subscription.user.wallet) {
      this.logger.error(`[createTransactionAndCreditWallet] Wallet não encontrada para userId=${subscription.userId}`);
      return;
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        userId: subscription.userId,
        amount: amount.toNumber(),
        netAmount: netAmount.toNumber(),
        status: TransactionStatus.COMPLETED,
        paymentMethod: PaymentMethod.CREDIT_CARD,
        description,
        totalFee: domFee.toNumber(),
        domFee: domFee.toNumber(),
        domPaymentId: domPaymentId ?? undefined,
        customerName: subscription.customer?.name ?? undefined,
        customerEmail: subscription.customer?.email ?? undefined,
        customerDocument: subscription.customer?.document ?? undefined,
        customerPhone: subscription.customer?.phone ?? undefined,
      },
    });

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'active' },
    });

    const walletBefore = await this.prisma.wallet.findUnique({
      where: { userId: subscription.userId },
    });

    const walletAfter = await this.prisma.wallet.update({
      where: { userId: subscription.userId },
      data: {
        version: { increment: 1 },
        balance: { increment: netAmount.toNumber() },
      },
    });

    await this.balanceLogs.create({
      userId: subscription.userId,
      action: 'SUBSCRIPTION_PAID',
      transactionId: transaction.id,
      amount: netAmount.toString(),
      balanceBefore: (walletBefore?.balance ?? new Prisma.Decimal(0)).toString(),
      balanceAfter: walletAfter.balance.toString(),
      lockedBefore: (walletBefore?.lockedBalance ?? new Prisma.Decimal(0)).toString(),
      lockedAfter: walletAfter.lockedBalance.toString(),
      description,
      source: 'SUBSCRIPTION',
      metadata: { subscriptionId: subscription.id },
    });

    this.logger.log(
      `[SubscriptionWebhook] Crédito R$${netAmount.toFixed(2)} para userId=${subscription.userId}, txId=${transaction.id}`,
    );
  }
}
