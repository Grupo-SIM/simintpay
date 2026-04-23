import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, TransactionStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TENANT_AREAFLIX_TAG, TENANT_COMUNIDADE_TAG } from '../../utils/internal-tags.util';
import {
  BALANCE_LOG_REPOSITORY,
} from '../../../core/repositories/balance-log.repository.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

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

    // Verificar se é uma SubscriptionLinkOrder (link de assinatura)
    const linkOrder = await this.prisma.subscriptionLinkOrder.findFirst({
      where: { domSubscriptionId: subscriberId },
      include: { subscriptionLink: true },
    });
    if (linkOrder) {
      await this.handleSubscriptionLinkRenewal(linkOrder, amount, domFee, domTransactionId, 'SIGNATURE-INVOICE-PAID');
      return;
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

    const effectivePlanTag = (subscription.plan as any)?.plataformas?.[0]?.toUpperCase() ?? 'GLOBAL';
    // Taxa do vendedor: TAXA_LINK_PERCENT × base + TAXA_LINK_FIXA, cobrada uma vez por renovação
    // Se não tiver plataforma definida, usa as taxas do GLOBAL
    const basePlanPrice = Number((subscription.plan as any)?.price ?? 0) || amount.toNumber();
    const sellerFeePercent = getPlatformTaxaEffective(effectivePlanTag, 'TAXA_LINK_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
    const sellerFeeFixed = getPlatformTaxaEffective(effectivePlanTag, 'TAXA_LINK_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
    const platformFeeAmount = new Prisma.Decimal(Math.round((basePlanPrice * sellerFeePercent + sellerFeeFixed) * 100) / 100);
    const netAmount = amount.sub(domFee).sub(platformFeeAmount);

    await this.createTransactionAndCreditWallet({
      subscription,
      amount,
      netAmount,
      domFee,
      platformFeeAmount,
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

    // Verificar se é uma SubscriptionLinkOrder (link de assinatura)
    const linkOrder = await this.prisma.subscriptionLinkOrder.findFirst({
      where: { domSubscriptionId: subscriberId },
      include: { subscriptionLink: true },
    });
    if (linkOrder) {
      await this.handleSubscriptionLinkRenewal(linkOrder, amount, domFee, domTransactionId, 'CHARGE-APPROVED');
      return;
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
      this.logger.warn(`[handleChargeApproved] Subscription não encontrada para ${subscriberId}`);
      return;
    }

    const effectivePlanTag = (subscription.plan as any)?.plataformas?.[0]?.toUpperCase() ?? 'GLOBAL';
    // Taxa do vendedor: TAXA_LINK_PERCENT × base + TAXA_LINK_FIXA, cobrada uma vez por renovação
    // Se não tiver plataforma definida, usa as taxas do GLOBAL
    const basePlanPrice = Number((subscription.plan as any)?.price ?? 0) || amount.toNumber();
    const sellerFeePercent = getPlatformTaxaEffective(effectivePlanTag, 'TAXA_LINK_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
    const sellerFeeFixed = getPlatformTaxaEffective(effectivePlanTag, 'TAXA_LINK_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
    const platformFeeAmount = new Prisma.Decimal(Math.round((basePlanPrice * sellerFeePercent + sellerFeeFixed) * 100) / 100);
    const netAmount = amount.sub(domFee).sub(platformFeeAmount);

    await this.createTransactionAndCreditWallet({
      subscription,
      amount,
      netAmount,
      domFee,
      platformFeeAmount,
      domPaymentId: domTransactionId,
      description: this.getString(data.product_first) ?? this.getString(data.description) ?? subscription.plan?.name ?? '-',
    });
  }

  private async handleSubscriptionLinkRenewal(
    linkOrder: any,
    amount: Prisma.Decimal,
    domFee: Prisma.Decimal,
    domTransactionId: string | null,
    source: string,
  ): Promise<void> {
    const link = linkOrder.subscriptionLink;
    let platformFeeAmount = 0;
    if (!link.isStandalone) {
      const effectivePlatformTag = ((link as any).platformTag ?? (link as any).plataformas?.[0] ?? 'GLOBAL').toString().toUpperCase();
      const baseLinkPrice = Number(link.amount ?? 0);
      const sellerFeePercent = getPlatformTaxaEffective(effectivePlatformTag, 'TAXA_LINK_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
      const sellerFeeFixed = getPlatformTaxaEffective(effectivePlatformTag, 'TAXA_LINK_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
      platformFeeAmount = Math.round((baseLinkPrice * sellerFeePercent + sellerFeeFixed) * 100) / 100;
    }
    const netAmount = amount.sub(domFee).sub(new Prisma.Decimal(platformFeeAmount));

    // Criar nova ordem para registro da renovação
    const newOrder = await this.prisma.subscriptionLinkOrder.create({
      data: {
        subscriptionLinkId: link.id,
        userId: linkOrder.userId,
        customerName: linkOrder.customerName,
        customerEmail: linkOrder.customerEmail,
        customerDocument: linkOrder.customerDocument,
        customerPhone: linkOrder.customerPhone,
        paymentMethod: 'CREDIT_CARD',
        status: 'paid',
        amountCharged: amount.toNumber(),
        platformFeeAmount,
      },
    });

    // Creditar wallet do dono do link
    const owner = await this.prisma.user.findUnique({
      where: { id: linkOrder.userId },
      include: { wallet: true },
    });
    if (owner?.wallet) {
      const walletBefore = await this.prisma.wallet.findUnique({ where: { userId: owner.id } });
      const walletAfter = await this.prisma.wallet.update({
        where: { userId: owner.id },
        data: { version: { increment: 1 }, balance: { increment: netAmount.toNumber() } },
      });
      await this.balanceLogs.create({
        userId: owner.id,
        action: 'SUBSCRIPTION_LINK_RENEWAL',
        transactionId: newOrder.id,
        amount: netAmount.toString(),
        balanceBefore: (walletBefore?.balance ?? new Prisma.Decimal(0)).toString(),
        balanceAfter: walletAfter.balance.toString(),
        lockedBefore: (walletBefore?.lockedBalance ?? new Prisma.Decimal(0)).toString(),
        lockedAfter: walletAfter.lockedBalance.toString(),
        description: `Renovação ${link.name}`,
        source: 'SUBSCRIPTION_LINK',
        metadata: { orderId: newOrder.id, source },
      });
    }

    // Notificar webhook externo (saas-netflix-back) com evento subscription_renewed
    const webhookUrl = link.webhookUrl ?? null;
    if (webhookUrl) {
      const token = process.env.SIMPAY_WEBHOOK_TOKEN ?? '';
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-simpay-token': token },
        body: JSON.stringify({
          event: 'subscription_renewed',
          customerEmail: linkOrder.customerEmail,
          customerName: linkOrder.customerName,
          planName: link.name,
          paymentMethod: 'CREDIT_CARD',
          frequencyType: link.frequencyType,
          amountCharged: amount.toNumber(),
          orderId: newOrder.id,
        }),
      }).catch((err: unknown) => {
        this.logger.warn(`[SubscriptionLinkRenewal] Falha ao notificar ${webhookUrl}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    this.logger.log(`[SubscriptionLinkRenewal] Renovação processada para ${linkOrder.customerEmail}, orderId=${newOrder.id}, source=${source}`);

    // Consolidado / relatórios: assinatura por link não criava Transaction (só Order + wallet).
    const wh = (link.webhookUrl ?? '').toLowerCase();
    if (wh.includes('areaflix')) {
      const payId = domTransactionId?.trim() || `AREAFLIX_SL_${newOrder.id}`;
      const dup = await this.prisma.transaction.findFirst({
        where: { domPaymentId: payId },
        select: { id: true },
      });
      if (!dup) {
        await this.prisma.transaction.create({
          data: {
            userId: link.userId,
            amount: amount.toNumber(),
            netAmount: netAmount.toNumber(),
            status: TransactionStatus.COMPLETED,
            paymentMethod: PaymentMethod.CREDIT_CARD,
            totalFee: domFee.toNumber(),
            domFee: domFee.toNumber(),
            platformFee: platformFeeAmount,
            description: `Assinatura link ${link.name} ${TENANT_AREAFLIX_TAG} order=${newOrder.id}`,
            domPaymentId: payId,
            customerName: linkOrder.customerName ?? undefined,
            customerEmail: linkOrder.customerEmail ?? undefined,
            customerDocument: linkOrder.customerDocument ?? undefined,
            customerPhone: linkOrder.customerPhone ?? undefined,
          },
        });
      }
    } else {
      const hasCommunity = await this.prisma.communityLinkBinding.findFirst({
        where: { subscriptionLinkId: link.id },
        select: { id: true },
      });
      if (hasCommunity) {
        const payId = domTransactionId?.trim() || `COMUNIDADE_SL_${newOrder.id}`;
        const dup = await this.prisma.transaction.findFirst({
          where: { domPaymentId: payId },
          select: { id: true },
        });
        if (!dup) {
          await this.prisma.transaction.create({
            data: {
              userId: link.userId,
              amount: amount.toNumber(),
              netAmount: netAmount.toNumber(),
              status: TransactionStatus.COMPLETED,
              paymentMethod: PaymentMethod.CREDIT_CARD,
              totalFee: domFee.toNumber(),
              domFee: domFee.toNumber(),
              platformFee: platformFeeAmount,
              description: `Assinatura link ${link.name} ${TENANT_COMUNIDADE_TAG} order=${newOrder.id}`,
              domPaymentId: payId,
              customerName: linkOrder.customerName ?? undefined,
              customerEmail: linkOrder.customerEmail ?? undefined,
              customerDocument: linkOrder.customerDocument ?? undefined,
              customerPhone: linkOrder.customerPhone ?? undefined,
            },
          });
        }
      }
    }
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

    // Se esta assinatura foi pausada pelo admin, o cancelamento na DOM foi
    // intencional — não sobrescrever o estado de pausa com 'cancelled'.
    const isPaused = await this.prisma.subscriptionPause.findUnique({
      where: { domSubscriptionId: subscriberId },
      select: { id: true },
    });
    if (isPaused) {
      this.logger.log(`[handleCancelled] ${subscriberId} está pausada — webhook de cancelamento ignorado`);
      return;
    }

    // Verificar se é uma SubscriptionLinkOrder
    const linkOrder = await this.prisma.subscriptionLinkOrder.findFirst({
      where: { domSubscriptionId: subscriberId },
      include: { subscriptionLink: true },
    });
    if (linkOrder) {
      await this.prisma.subscriptionLinkOrder.update({
        where: { id: linkOrder.id },
        data: { status: 'cancelled' },
      });
      const webhookUrl = linkOrder.subscriptionLink?.webhookUrl ?? null;
      if (webhookUrl) {
        const token = process.env.SIMPAY_WEBHOOK_TOKEN ?? '';
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-simpay-token': token },
          body: JSON.stringify({
            event: 'subscription_expired',
            customerEmail: linkOrder.customerEmail,
            customerName: linkOrder.customerName,
            planName: linkOrder.subscriptionLink.name,
            paymentMethod: 'CREDIT_CARD',
            frequencyType: linkOrder.subscriptionLink.frequencyType,
            amountCharged: 0,
            orderId: linkOrder.id,
          }),
        }).catch((err: unknown) => {
          this.logger.warn(`[handleCancelled] Falha ao notificar ${webhookUrl}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      this.logger.log(`[handleCancelled] SubscriptionLinkOrder ${linkOrder.id} cancelada e webhook externo notificado`);
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
    platformFeeAmount: Prisma.Decimal;
    domPaymentId: string | null;
    description: string;
  }): Promise<void> {
    const { subscription, amount, netAmount, domFee, platformFeeAmount, domPaymentId, description } = input;

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
        totalFee: domFee.add(platformFeeAmount).toNumber(),
        domFee: domFee.toNumber(),
        platformFee: platformFeeAmount.toNumber(),
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
