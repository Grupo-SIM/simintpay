import { captureCoproduction, withCoproduction } from '../../../modules/coproduction/coproduction.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { loadChargePolicy, quoteFinancialCharge } from '../../../modules/financial-policy/financial-charge';
import { assertExplicitPlatform, platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { CheckoutSubscriptionLinkPixDto } from '../../dtos/subscription-link/checkout-subscription-link.dto';
import { getModuleDomToken } from '../../../modules/module.registry';
import { CommunityManagementService } from '../../services/community-management.service';
import { getPlatformTaxaEffective, buildClientTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { VoucherService } from '../voucher/voucher.service';

function mapPlanFrequencyToDom(linkFrequency: string): { frequency_type: 'WEEK' | 'MONTH' | 'YEAR'; frequency: number } {
  // Frequências suportadas: Semanal (WEEK), Mensal (MONTH), Anual (YEAR) — os 3 tipos da DOM.
  switch (linkFrequency) {
    case 'WEEKLY':
    case 'SEMANAL':
      return { frequency_type: 'WEEK', frequency: 1 };
    case 'ANUAL':
    case 'YEAR':
      return { frequency_type: 'YEAR', frequency: 1 };
    default:
      return { frequency_type: 'MONTH', frequency: 1 };
  }
}

@Injectable()
export class CheckoutSubscriptionLinkPixUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly communities: CommunityManagementService,
    private readonly voucherService: VoucherService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { code: string; dto: CheckoutSubscriptionLinkPixDto }) {
    const link = await this.repo.findByCode(input.code);
    if (!link || !link.isActive) throw new NotFoundException('Link de assinatura não encontrado ou inativo');
    if (link.maxUses != null && link.currentUses >= link.maxUses) {
      throw new BadRequestException('Limite de assinaturas atingido');
    }
    const owner = await this.users.findById(link.userId);
    const selectedTag = link.platformTag ?? link.plataformas?.[0] ?? owner?.platform?.tag ?? 'GLOBAL';
    const domToken = platformGatewayToken(selectedTag, process.env.DOM_TOKEN);
    if (!domToken) throw new BadRequestException('Token do gateway não configurado');

    let domPlanId = link.domPlanId;
    if (!domPlanId) {
      const planFreq = mapPlanFrequencyToDom(link.frequencyType);
      const syncedPlan = await this.gateway.createPlan(domToken, {
        price: Number(link.amount),
        description: link.name,
        frequency_type: planFreq.frequency_type,
        frequency: planFreq.frequency,
        repetitions: 0,
        retry_days: 3,
        webhookUrl: link.webhookUrl ?? undefined,
        redirectUrl: link.redirectUrl ?? undefined,
      });
      domPlanId = syncedPlan.id;
      await this.repo.update(link.id, { domPlanId });
    }

    const base = Number(link.amount);

    // PIX: cliente paga o valor base; MDR_PIX é descontado do repasse ao vendedor (não somado ao cliente)
    let platformFeeAmount = 0;
    if (!link.isStandalone) {
      const slugTag = owner?.platform?.tag?.toUpperCase();
      const platformTag = selectedTag;
      // Taxa personalizada por cliente na SIM INT PAY (GLOBAL): tag CLIENT:<email> (cai no GLOBAL se não houver).
      const taxaTag = platformTag === 'GLOBAL' && input.dto.customerEmail?.trim()
        ? buildClientTaxaTag(input.dto.customerEmail)
        : platformTag;
      const mdrPix = getPlatformTaxaEffective(taxaTag, 'MDR_PIX', PLATFORM_TAXA_DEFAULTS.MDR_PIX);
      platformFeeAmount = Math.round(base * mdrPix * 100) / 100;
    }

    // PIX não soma taxa ao cliente: amountCharged = base sempre
    let amountCharged = base;
    let appliedVoucherId: string | undefined;

    if (input.dto.voucherCode) {
      const bridge = await this.voucherService.validateVoucher(link.userId, {
        code: input.dto.voucherCode,
        amount: base,
        channel: 'PAGATG',
        planId: link.id,
      });

      if (bridge && bridge.valid) {
        amountCharged = bridge.finalAmount;
        appliedVoucherId = bridge.voucherId;
      } else {
        throw new BadRequestException('Cupom inválido ou expirado');
      }
    }

    const financialQuote = quoteFinancialCharge(await loadChargePolicy(this.prisma, selectedTag), amountCharged, 'PIX');
    if (financialQuote) { amountCharged = financialQuote.totalAmount; platformFeeAmount = financialQuote.totalFeeAmount; }
    const coproduction = await captureCoproduction(this.prisma, 'links-assinatura', link.id, link.userId, selectedTag);
    const legacyDomFee = 0;
    const coproductionFinancialSnapshot = withCoproduction(financialQuote?.financialSnapshot, coproduction, {
      totalAmount: amountCharged, netAmount: Math.round((amountCharged - platformFeeAmount - legacyDomFee) * 100) / 100,
      totalFeeAmount: platformFeeAmount + legacyDomFee, domFeeAmount: legacyDomFee, platformProfit: platformFeeAmount, policyTag: selectedTag,
    });
    const cleanDoc = input.dto.customerDocument.replace(/\D/g, '');
    const documentType = cleanDoc.length === 14 ? 'CNPJ' : 'CPF';
    const cleanPhone = (input.dto.customerPhone ?? '').replace(/\D/g, '');
    const codExternal = `sub-link-pix-${link.id}-${Date.now()}`;

    let order = await this.repo.createOrder({
      subscriptionLinkId: link.id,
      userId: link.userId,
      customerName: input.dto.customerName,
      customerEmail: input.dto.customerEmail,
      customerDocument: cleanDoc,
      customerPhone: cleanPhone || null,
      paymentMethod: 'PIX',
      status: 'pending',
      amountCharged,
      platformFeeAmount,
      ...(coproductionFinancialSnapshot ? { financialSnapshot: coproductionFinancialSnapshot } : {}),
    });

    const result = await this.gateway.chargePixForLink(domToken, {
      domLinkId: domPlanId,
      amount: amountCharged,
      description: link.name,
      customerName: input.dto.customerName,
      customerEmail: input.dto.customerEmail,
      customerDocument: cleanDoc,
      customerPhone: cleanPhone,
      documentType,
      codExternal,
    }).catch(async (error: unknown) => { await this.prisma.subscriptionLinkOrder.update({ where: { id: order.id }, data: { status: 'failed' } }); throw error; });

    const pixExpire = result.pixExpire ? new Date(result.pixExpire) : null;

    order = await this.prisma.subscriptionLinkOrder.update({ where: { id: order.id }, data: { domPixPaymentId: result.id, pixContent: result.pixContent ?? null, pixExpire } });

    await this.repo.update(link.id, { currentUses: link.currentUses + 1 });

    const community = await this.communities.findBoundCommunityForSubscriptionLink(link.id);
    if (community) {
      await this.communities.registerPendingPix({
        communityId: community.id,
        userId: link.userId,
        frequencyType: link.frequencyType,
        paymentMethod: 'PIX',
        amountCharged,
        subscriptionLinkOrderId: order.id,
      });
    }

    return {
      id: order.id,
      domPaymentId: result.id,
      status: order.status,
      pixContent: result.pixContent ?? null,
      qrCode: result.qrCode ?? null,
      pixExpire: result.pixExpire ?? null,
      amount: amountCharged,
    };
  }
}
