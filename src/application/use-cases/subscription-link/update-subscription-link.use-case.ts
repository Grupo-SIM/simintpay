import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { UpdateSubscriptionLinkDto } from '../../dtos/subscription-link/update-subscription-link.dto';

@Injectable()
export class UpdateSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
  ) {}

  async execute(input: { userId: string; role?: string; id: string; dto: UpdateSubscriptionLinkDto }) {
    const existing = input.role === 'ADMIN'
      ? await this.repo.findById(input.id)
      : await this.repo.findByIdForUser({ id: input.id, userId: input.userId });
    if (!existing) throw new NotFoundException('Link de assinatura não encontrado');

    const updated = await this.repo.update(existing.id, {
      name: input.dto.nome ?? existing.name,
      description: input.dto.descricao ?? existing.description,
      isActive: input.dto.isActive ?? existing.isActive,
      isStandalone: input.dto.isStandalone ?? existing.isStandalone,
      platformFee: input.dto.platformFee ?? existing.platformFee,
      redirectUrl: input.dto.redirectUrl ?? existing.redirectUrl,
      webhookUrl: input.dto.webhookUrl ?? existing.webhookUrl,
      maxUses: input.dto.maxUses ?? existing.maxUses,
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
