import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { CheckoutSubscriptionLinkCardDto } from '../../dtos/subscription-link/checkout-subscription-link.dto';
import { getModuleDomToken } from '../../../modules/module.registry';
import { CommunityManagementService } from '../../services/community-management.service';
import { EmailService } from '../../../infrastructure/email/email.service';

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
export class CheckoutSubscriptionLinkCardUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly communities: CommunityManagementService,
    private readonly emailService: EmailService,
  ) { }

  async execute(input: { code: string; dto: CheckoutSubscriptionLinkCardDto }) {
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
    const cleanPhone = (input.dto.customerPhone ?? '').replace(/\D/g, '');

    const domResult = await this.gateway.createSubscriptionFromCheckout(domToken, {
      planId: domPlanId,
      customer: {
        name: input.dto.customerName,
        email: input.dto.customerEmail,
        document: cleanDoc,
        phone: cleanPhone,
      },
      card: input.dto.card,
    });

    // Alinhado à api-dom (subscription-link.service): cartão recusado / assinatura inválida na resposta síncrona
    const statusLower = (domResult.status ?? '').toString().toLowerCase();
    const cardNotAuthorized = ['inactive', 'cancelled', 'canceled', 'suspended'].includes(statusLower);
    if (cardNotAuthorized) {
      throw new BadRequestException(
        'Pagamento não autorizado. Tente outro cartão ou forma de pagamento.',
      );
    }

    const VALID = ['active', 'pending', 'trial'];
    if (!VALID.includes(statusLower)) {
      throw new BadRequestException(
        `Assinatura recusada pelo gateway${domResult.status ? `: ${domResult.status}` : ''}.`,
      );
    }

    const order = await this.repo.createOrder({
      subscriptionLinkId: link.id,
      userId: link.userId,
      customerName: input.dto.customerName,
      customerEmail: input.dto.customerEmail,
      customerDocument: cleanDoc,
      customerPhone: cleanPhone || null,
      paymentMethod: 'CREDIT_CARD',
      status: (domResult.status ?? 'pending').toLowerCase(),
      domSubscriptionId: domResult.id,
      amountCharged,
      platformFeeAmount,
    });

    await this.repo.update(link.id, { currentUses: link.currentUses + 1 });

    const community = await this.communities.findBoundCommunityForSubscriptionLink(link.id);
    if (community) {
      await this.communities.activateOrRenewCommunityAccess({
        communityId: community.id,
        userId: link.userId,
        frequencyType: link.frequencyType,
        paymentMethod: 'CREDIT_CARD',
        amountCharged,
        subscriptionLinkOrderId: order.id,
      });
    }

    try {
      await this.emailService.sendSubscriptionAccess({
        to: input.dto.customerEmail,
        customerName: input.dto.customerName,
        linkName: link.name,
        redirectUrl: link.redirectUrl ?? null,
        orderId: order.id,
      });
    } catch {
      // Email failure must not block the checkout response
    }

    return {
      id: order.id,
      status: order.status,
      redirectUrl: link.redirectUrl ?? null,
    };
  }
}
