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

function mapPlanFrequencyToDom(linkFrequency: string): { frequency_type: 'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR'; frequency: number } {
  switch (linkFrequency) {
    case 'TRIMESTRAL':
      return { frequency_type: 'QUARTER', frequency: 1 };
    case 'SEMESTRAL':
      return { frequency_type: 'SEMESTER', frequency: 1 };
    case 'ANUAL':
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
  ) {}

  async execute(input: { code: string; dto: CheckoutSubscriptionLinkPixDto }) {
    const link = await this.repo.findByCode(input.code);
    if (!link || !link.isActive) throw new NotFoundException('Link de assinatura não encontrado ou inativo');
    if (link.maxUses != null && link.currentUses >= link.maxUses) {
      throw new BadRequestException('Limite de assinaturas atingido');
    }
    const owner = await this.users.findById(link.userId);
    let domToken: string | null | undefined = owner?.domToken;
    if (!domToken && owner?.tenantModule?.slug) domToken = getModuleDomToken(owner.tenantModule.slug);
    if (!domToken) domToken = process.env.DOM_TOKEN;
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
    const platformFeeAmount = link.isStandalone ? 0 : Math.round(base * (link.platformFee / 100) * 100) / 100;
    const amountCharged = base + platformFeeAmount;

    const cleanDoc = input.dto.customerDocument.replace(/\D/g, '');
    const documentType = cleanDoc.length === 14 ? 'CNPJ' : 'CPF';
    const cleanPhone = (input.dto.customerPhone ?? '').replace(/\D/g, '');
    const codExternal = `sub-link-pix-${link.id}-${Date.now()}`;

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
    });

    const pixExpire = result.pixExpire ? new Date(result.pixExpire) : null;

    const order = await this.repo.createOrder({
      subscriptionLinkId: link.id,
      userId: link.userId,
      customerName: input.dto.customerName,
      customerEmail: input.dto.customerEmail,
      customerDocument: cleanDoc,
      customerPhone: cleanPhone || null,
      paymentMethod: 'PIX',
      status: 'pending',
      domPixPaymentId: result.id,
      pixContent: result.pixContent ?? null,
      pixExpire,
      amountCharged,
      platformFeeAmount,
    });

    await this.repo.update(link.id, { currentUses: link.currentUses + 1 });

    const community = await this.communities.ensureAutomaticBindingForSubscriptionLink({
      subscriptionLinkId: link.id,
      linkName: link.name,
      linkDescription: link.description,
    });
    await this.communities.registerPendingPix({
      communityId: community.id,
      userId: link.userId,
      frequencyType: link.frequencyType,
      paymentMethod: 'PIX',
      amountCharged,
      subscriptionLinkOrderId: order.id,
    });

    return {
      id: order.id,
      status: order.status,
      pixContent: result.pixContent ?? null,
      qrCode: result.qrCode ?? null,
      pixExpire: result.pixExpire ?? null,
      amount: amountCharged,
    };
  }
}
