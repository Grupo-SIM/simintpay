import { settleFinancialSubscription } from '../../../modules/financial-policy/financial-subscription';
import { getPlatformIntegrationValue } from '../../../modules/platform-integrations/platform-integrations.store';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, TransactionStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TENANT_AREAFLIX_TAG } from '../../utils/internal-tags.util';
import {
  BALANCE_LOG_REPOSITORY,
} from '../../../core/repositories/balance-log.repository.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';
import { getPlatformTaxaEffective, buildClientTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { splitDocument } from '../../utils/document.util';
import { isAreaflixLink, calculateAreaflixSellerNet } from '../../helpers/areaflix-fees.helper';
import { PlatformAccessService } from '../../services/platform-access.service';
import { advanceSubscriptionPeriod } from '../../helpers/subscription-period.helper';
import { buildBillingTransactionDescription } from '../../helpers/billing-transaction-description.helper';

@Injectable()
export class SubscriptionWebhookService {
  private readonly logger = new Logger(SubscriptionWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BALANCE_LOG_REPOSITORY)
    private readonly balanceLogs: IBalanceLogRepository,
    private readonly platformAccess: PlatformAccessService,
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

    if (subscription.financialSnapshot && domTransactionId) {
      await settleFinancialSubscription(this.prisma, { snapshot: subscription.financialSnapshot, amount, paymentId: domTransactionId, userId: subscription.userId, method: 'CREDIT_CARD', name: subscription.plan.name, customerName: subscription.customer?.name, customerEmail: subscription.customer?.email, customerDocument: subscription.customer?.document });
      return;
    }
    const effectivePlanTag = (subscription.plan as any)?.plataformas?.[0]?.toUpperCase() ?? 'GLOBAL';
    // Taxa personalizada por cliente na SIM INT PAY (GLOBAL): tag CLIENT:<email> (cai no GLOBAL se não houver).
    const taxaTag = effectivePlanTag === 'GLOBAL' && subscription.customer?.email?.trim()
      ? buildClientTaxaTag(subscription.customer.email)
      : effectivePlanTag;
    // Taxa do vendedor: TAXA_LINK_PERCENT × base + TAXA_LINK_FIXA, cobrada uma vez por renovação
    // Se não tiver plataforma definida, usa as taxas do GLOBAL
    const basePlanPrice = Number((subscription.plan as any)?.price ?? 0) || amount.toNumber();
    const sellerFeePercent = getPlatformTaxaEffective(taxaTag, 'TAXA_LINK_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
    const sellerFeeFixed = getPlatformTaxaEffective(taxaTag, 'TAXA_LINK_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
    const platformFeeAmount = new Prisma.Decimal(Math.round((basePlanPrice * sellerFeePercent + sellerFeeFixed) * 100) / 100);
    const netAmount = amount.sub(domFee).sub(platformFeeAmount);

    await this.createTransactionAndCreditWallet({
      subscription,
      amount,
      netAmount,
      domFee,
      platformFeeAmount,
      domPaymentId: domTransactionId,
      description: (() => { const d = this.getString(data.description) ?? subscription.plan?.name ?? '-'; return effectivePlanTag !== 'GLOBAL' ? `${d} [TENANT:${effectivePlanTag}]` : d; })(),
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
      const failedLinkOrder = await this.prisma.subscriptionLinkOrder.findFirst({
        where: { domSubscriptionId: subscriberId },
        select: { id: true, issueStartedAt: true },
      });
      if (failedLinkOrder) {
        await this.prisma.subscriptionLinkOrder.update({
          where: { id: failedLinkOrder.id },
          data: {
            status: 'payment_failed',
            issueStartedAt: failedLinkOrder.issueStartedAt ?? new Date(),
          },
        });
        this.logger.warn(
          `[handleChargeApproved] Pagamento negado (${chargeStatus}), SubscriptionLinkOrder ${failedLinkOrder.id} -> payment_failed`,
        );
        return;
      }

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

    if (await this.recordBillingContractCharge({
      subscriberId,
      domPaymentId: domTransactionId,
      chargeStatus,
      amount,
      domFee,
      data,
    })) {
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

    if (subscription.financialSnapshot && domTransactionId) {
      await settleFinancialSubscription(this.prisma, { snapshot: subscription.financialSnapshot, amount, paymentId: domTransactionId, userId: subscription.userId, method: 'CREDIT_CARD', name: subscription.plan.name, customerName: subscription.customer?.name, customerEmail: subscription.customer?.email, customerDocument: subscription.customer?.document });
      return;
    }
    const effectivePlanTag = (subscription.plan as any)?.plataformas?.[0]?.toUpperCase() ?? 'GLOBAL';
    // Taxa personalizada por cliente na SIM INT PAY (GLOBAL): tag CLIENT:<email> (cai no GLOBAL se não houver).
    const taxaTag = effectivePlanTag === 'GLOBAL' && subscription.customer?.email?.trim()
      ? buildClientTaxaTag(subscription.customer.email)
      : effectivePlanTag;
    // Taxa do vendedor: TAXA_LINK_PERCENT × base + TAXA_LINK_FIXA, cobrada uma vez por renovação
    // Se não tiver plataforma definida, usa as taxas do GLOBAL
    const basePlanPrice = Number((subscription.plan as any)?.price ?? 0) || amount.toNumber();
    const sellerFeePercent = getPlatformTaxaEffective(taxaTag, 'TAXA_LINK_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
    const sellerFeeFixed = getPlatformTaxaEffective(taxaTag, 'TAXA_LINK_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
    const platformFeeAmount = new Prisma.Decimal(Math.round((basePlanPrice * sellerFeePercent + sellerFeeFixed) * 100) / 100);
    const netAmount = amount.sub(domFee).sub(platformFeeAmount);

    await this.createTransactionAndCreditWallet({
      subscription,
      amount,
      netAmount,
      domFee,
      platformFeeAmount,
      domPaymentId: domTransactionId,
      description: (() => { const d = this.getString(data.product_first) ?? this.getString(data.description) ?? subscription.plan?.name ?? '-'; return effectivePlanTag !== 'GLOBAL' ? `${d} [TENANT:${effectivePlanTag}]` : d; })(),
    });
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

    const status = ['not_authorized', 'failed', 'expired', 'refused', 'error']
      .includes((input.chargeStatus ?? '').toLowerCase())
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
      domFee: input.domFee,
      platformFee: new Prisma.Decimal(0),
      description,
      customerName: this.getString(customer?.name) ?? this.getString(input.data.customer_name),
      customerEmail: this.getString(customer?.email) ?? this.getString(input.data.customer_email),
      customerDocument: this.getString(customer?.document) ?? this.getString(input.data.customer_document),
      customerPhone: this.getString(customer?.phone) ?? this.getString(input.data.customer_phone),
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

  /**
   * Provisiona a conta do cliente na plataforma SaaS correspondente ao link
   * (CONTROLE-MOTORISTA → saas-consumo-back, CONTROLE-PATRIMONIAL → saas-controle-patrimonial-back)
   * e dispara o email de credenciais (login + senha aleatória) na conta nova, ou de renovação
   * quando a conta já existe. Idempotente no SaaS. Plataformas sem provisionamento são ignoradas.
   * Mesma chamada usada no fluxo PIX (process-dom-webhook) — agora também no cartão recorrente.
   */
  private async provisionSaasUserForLink(
    link: any,
    order: { customerEmail?: string | null; customerName?: string | null; customerDocument?: string | null; customerPhone?: string | null },
  ): Promise<void> {
    const tag = ((link?.platformTag ?? link?.plataformas?.[0] ?? '') as string).toString().toUpperCase();
    let url = '';
    if (tag === 'CONTROLE-MOTORISTA') {
      url = String((getPlatformIntegrationValue('CONTROLE-MOTORISTA', 'BACKEND_URL') ?? undefined) ?? '').replace(/\/+$/, '');
    } else if (tag === 'CONTROLE-PATRIMONIAL') {
      url = String((getPlatformIntegrationValue('CONTROLE-PATRIMONIAL', 'BACKEND_URL') ?? undefined) ?? '').replace(/\/+$/, '');
    } else if (tag === 'BETAI') {
      url = String((getPlatformIntegrationValue('BETAI', 'BACKEND_URL') ?? undefined) ?? '').replace(/\/+$/, '');
    } else {
      return; // plataforma sem provisionamento de conta automática
    }

    const token = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '';
    if (!url || !token) {
      this.logger.warn(`[SubscriptionLink][${tag}] URL ou token interno não configurado — provisão ignorada`);
      return;
    }
    if (!order.customerEmail || !order.customerName) {
      this.logger.warn(`[SubscriptionLink][${tag}] email ou nome do cliente ausente — provisão ignorada`);
      return;
    }

    try {
      const res = await fetch(`${url}/internal/users/provision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: JSON.stringify({
          email: order.customerEmail,
          name: order.customerName,
          ...splitDocument(order.customerDocument),
          phone: order.customerPhone ?? undefined,
        }),
      });
      const text = await res.text();
      this.logger.log(`[SubscriptionLink][${tag}] provision HTTP ${res.status} email=${order.customerEmail}: ${text.slice(0, 200)}`);
    } catch (err: unknown) {
      this.logger.warn(`[SubscriptionLink][${tag}] provision falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleSubscriptionLinkRenewal(
    linkOrder: any,
    amount: Prisma.Decimal,
    domFee: Prisma.Decimal,
    domTransactionId: string | null,
    source: string,
  ): Promise<void> {
    const link = linkOrder.subscriptionLink;
    const financialQuote = linkOrder.financialSnapshot && domTransactionId ? await settleFinancialSubscription(this.prisma, {
      snapshot: linkOrder.financialSnapshot, amount, paymentId: domTransactionId, userId: linkOrder.userId, method: 'CREDIT_CARD', name: link.name,
      customerName: linkOrder.customerName, customerEmail: linkOrder.customerEmail, customerDocument: linkOrder.customerDocument,
    }) : null;
    const now = new Date();
    const periodBase =
      linkOrder.currentPeriodEndsAt && linkOrder.currentPeriodEndsAt > now
        ? linkOrder.currentPeriodEndsAt
        : now;
    const currentPeriodEndsAt = advanceSubscriptionPeriod(periodBase, link.frequencyType);

    await this.prisma.subscriptionLinkOrder.update({
      where: { id: linkOrder.id },
      data: {
        status: 'active',
        currentPeriodEndsAt,
        issueStartedAt: null,
        cancelledAt: null,
      },
    });

    // Cartão recorrente: provisiona/garante a conta do cliente na plataforma SaaS
    // (motorista/patrimonial) e dispara o email com login + senha (conta nova) ou de renovação.
    // O webhook é quem credita a wallet, então ele sempre dispara — inclusive na 1ª cobrança do
    // cartão. Logo isto cobre o primeiro pagamento E as renovações (idempotente no SaaS).
    void this.provisionSaasUserForLink(link, linkOrder);

    // Credita/estende a janela de acesso (PlatformSubscriberAccess) também no cartão — antes só
    // o PIX fazia isso. Sem esta janela o cron de expiração não teria como avisar/bloquear o
    // cartão. Dias conforme a frequência do link (MENSAL 30 … ANUAL 365).
    const accessTag = ((link?.platformTag ?? link?.plataformas?.[0] ?? '') as string).toUpperCase();
    if (accessTag === 'CONTROLE-MOTORISTA' || accessTag === 'CONTROLE-PATRIMONIAL' || accessTag === 'BETAI') {
      void this.platformAccess.creditAccess({
        platformTag: accessTag,
        email: linkOrder.customerEmail,
        name: linkOrder.customerName,
        cpf: linkOrder.customerDocument,
        phone: linkOrder.customerPhone,
        paymentMethod: 'CREDIT_CARD',
        planDays: this.platformAccess.daysForFrequency(link?.frequencyType),
        transactionId: domTransactionId ?? linkOrder.id,
      });
    }

    const isAfLink = isAreaflixLink({
      webhookUrl: link.webhookUrl,
      platformTag: (link as any).platformTag,
      plataformas: (link as any).plataformas,
    });

    let platformFeeAmount = 0;
    if (!link.isStandalone && !isAfLink) {
      const effectivePlatformTag = ((link as any).platformTag ?? (link as any).plataformas?.[0] ?? 'GLOBAL').toString().toUpperCase();
      // Taxa personalizada por cliente na SIM INT PAY (GLOBAL): tag CLIENT:<email> (cai no GLOBAL se não houver).
      const taxaTag = effectivePlatformTag === 'GLOBAL' && linkOrder.customerEmail?.trim()
        ? buildClientTaxaTag(linkOrder.customerEmail)
        : effectivePlatformTag;
      const baseLinkPrice = Number(link.amount ?? 0);
      const sellerFeePercent = getPlatformTaxaEffective(taxaTag, 'TAXA_LINK_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
      const sellerFeeFixed = getPlatformTaxaEffective(taxaTag, 'TAXA_LINK_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
      platformFeeAmount = Math.round((baseLinkPrice * sellerFeePercent + sellerFeeFixed) * 100) / 100;
    }

    // AREAFLIX: líquido do vendedor = valor − % do método − taxa fixa (taxas do painel).
    // Renovação de assinatura é cobrada no cartão (1x).
    const netAmount = financialQuote ? new Prisma.Decimal(financialQuote.netAmount) : isAfLink
      ? new Prisma.Decimal(
          calculateAreaflixSellerNet(amount.toNumber(), 'CREDIT_CARD', 1).toFixed(2),
        )
      : amount.sub(domFee).sub(new Prisma.Decimal(platformFeeAmount));

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
        ...(financialQuote ? { financialSnapshot: linkOrder.financialSnapshot as Prisma.InputJsonValue } : {}),
        platformFeeAmount: financialQuote?.totalFeeAmount ?? platformFeeAmount,
        currentPeriodEndsAt,
      },
    });

    if (financialQuote && domTransactionId) {
      await this.prisma.transaction.updateMany({ where: { domPaymentId: domTransactionId, userId: linkOrder.userId },
        data: { description: `${link.name} [TENANT:${financialQuote.financialSnapshot.policyTag}] subOrder=${newOrder.id}` } });
    }

    // Creditar wallet do dono do link
    const owner = await this.prisma.user.findUnique({
      where: { id: linkOrder.userId },
      include: { wallet: true },
    });
    if (owner?.wallet && !financialQuote) {
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
          netAmount: Number(netAmount.toFixed(2)),
          orderId: newOrder.id,
          linkId: link.id,
          ...splitDocument(linkOrder.customerDocument),
          phone: linkOrder.customerPhone ?? undefined,
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
      // Resolve a tag de tenant: plataforma do link (CONTROLE-MOTORISTA/PATRIMONIAL) tem
      // prioridade; senão, comunidade vinculada. A Transaction [TENANT:<tag>] é necessária
      // para os relatórios por produto e para o dedup por domPaymentId nos handlers acima
      // (evita crédito de wallet e provisão de conta em duplicidade quando o DOM reenvia o webhook).
      const linkTag = ((link as any).platformTag ?? (link as any).plataformas?.[0] ?? '').toString().toUpperCase();
      let tenantTag: string | null = null;
      if (linkTag === 'CONTROLE-MOTORISTA' || linkTag === 'CONTROLE-PATRIMONIAL' || linkTag === 'BETAI') {
        tenantTag = linkTag;
      } else {
        const hasCommunity = await this.prisma.communityLinkBinding.findFirst({
          where: { subscriptionLinkId: link.id },
          select: { id: true, community: { select: { slug: true } } },
        });
        if (hasCommunity) tenantTag = hasCommunity.community.slug.toUpperCase();
      }
      if (tenantTag) {
        const payId = domTransactionId?.trim() || `SL_${tenantTag}_${newOrder.id}`;
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
              description: `Assinatura link ${link.name} [TENANT:${tenantTag}] order=${newOrder.id}`,
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
      const now = new Date();
      await this.prisma.subscriptionLinkOrder.update({
        where: { id: linkOrder.id },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          currentPeriodEndsAt:
            linkOrder.currentPeriodEndsAt ??
            advanceSubscriptionPeriod(linkOrder.createdAt, linkOrder.subscriptionLink.frequencyType),
        },
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
            netAmount: 0,
            orderId: linkOrder.id,
            linkId: linkOrder.subscriptionLinkId,
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
