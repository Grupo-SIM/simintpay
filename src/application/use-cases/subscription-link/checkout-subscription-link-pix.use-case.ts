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
    if (!link.domPlanId) throw new BadRequestException('Link ainda não sincronizado com o gateway');

    const owner = await this.users.findById(link.userId);
    let domToken: string | null | undefined = owner?.domToken;
    if (!domToken && owner?.tenantModule?.slug) domToken = getModuleDomToken(owner.tenantModule.slug);
    if (!domToken) domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new BadRequestException('Token do gateway não configurado');

    const base = Number(link.amount);
    const platformFeeAmount = link.isStandalone ? 0 : Math.round(base * (link.platformFee / 100) * 100) / 100;
    const amountCharged = base + platformFeeAmount;

    const cleanDoc = input.dto.customerDocument.replace(/\D/g, '');
    const documentType = cleanDoc.length === 14 ? 'CNPJ' : 'CPF';
    const cleanPhone = (input.dto.customerPhone ?? '').replace(/\D/g, '');
    const codExternal = `sub-link-pix-${link.id}-${Date.now()}`;

    const result = await this.gateway.chargePixForLink(domToken, {
      domLinkId: link.domPlanId,
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
