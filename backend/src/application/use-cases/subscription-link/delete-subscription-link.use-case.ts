import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class DeleteSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string; role?: string; id: string }) {
    const existing = input.role === 'ADMIN'
      ? await this.repo.findById(input.id)
      : await this.repo.findByIdForUser({ id: input.id, userId: input.userId });
    if (!existing) throw new NotFoundException('Link de assinatura não encontrado');

    // Desativa o plano na DOM se existir
    if (existing.domPlanId) {
      const domToken = platformGatewayToken(existing.platformTag ?? existing.plataformas?.[0], process.env.DOM_TOKEN);
      if (domToken) {
        try {
          await this.gateway.updatePaymentLink(domToken, existing.domPlanId, { isActive: false });
        } catch { /* não bloqueia a deleção local */ }
      }
    }

    await this.repo.delete(existing.id);
    return { deleted: true };
  }
}
