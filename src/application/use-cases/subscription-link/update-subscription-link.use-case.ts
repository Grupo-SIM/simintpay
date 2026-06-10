import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { UpdateSubscriptionLinkDto } from '../../dtos/subscription-link/update-subscription-link.dto';
import { CommunityManagementService } from '../../services/community-management.service';

@Injectable()
export class UpdateSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly communities: CommunityManagementService,
  ) {}

  async execute(input: { userId: string; role?: string; id: string; dto: UpdateSubscriptionLinkDto }) {
    const existing = input.role === 'ADMIN'
      ? await this.repo.findById(input.id)
      : await this.repo.findByIdForUser({ id: input.id, userId: input.userId });
    if (!existing) throw new NotFoundException('Link de assinatura não encontrado');

    const nextIsActive = input.dto.isActive ?? existing.isActive;

    // Propaga o status ativo/inativo para a DOM (bloqueia checkout e reassinatura externa)
    // quando o link tem plano na DOM e o status realmente mudou.
    if (input.dto.isActive !== undefined && input.dto.isActive !== existing.isActive && existing.domPlanId) {
      const domToken = process.env.DOM_TOKEN;
      if (domToken) {
        try {
          await this.gateway.updatePaymentLink(domToken, existing.domPlanId, { isActive: nextIsActive });
        } catch { /* não bloqueia a atualização local */ }
      }
    }

    const updated = await this.repo.update(existing.id, {
      name: input.dto.nome ?? existing.name,
      description: input.dto.descricao ?? existing.description,
      isActive: nextIsActive,
      isStandalone: input.dto.isStandalone ?? existing.isStandalone,
      platformFee: input.dto.platformFee ?? existing.platformFee,
      redirectUrl: input.dto.redirectUrl ?? existing.redirectUrl,
      webhookUrl: input.dto.webhookUrl ?? existing.webhookUrl,
      maxUses: input.dto.maxUses ?? existing.maxUses,
      platformTag: input.dto.platformTag !== undefined ? input.dto.platformTag : (existing as any).platformTag,
      ...(input.dto.emailBody !== undefined && { emailBody: input.dto.emailBody }),
      ...(input.dto.plataformas !== undefined && { plataformas: input.dto.plataformas }),
    });

    return {
      data: {
        id: updated.id,
        codigo: updated.code,
        nome: updated.name,
        descricao: updated.description ?? null,
        valor: Number(updated.amount),
        isStandalone: updated.isStandalone,
        platformFee: updated.platformFee,
        ativo: updated.isActive,
      },
    };
  }
}
