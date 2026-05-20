import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PlanType } from '@prisma/client';

function mapFreq(t: PlanType): string {
  const m: Record<PlanType, string> = {
    MONTHLY: 'MENSAL',
    TRIMESTRAL: 'TRIMESTRAL',
    SEMESTRAL: 'SEMESTRAL',
    ANUAL: 'ANUAL',
  };
  return m[t] ?? 'MENSAL';
}

@Injectable()
export class GetSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { userId: string; role?: string; id: string }) {
    const link =
      input.role === 'ADMIN'
        ? await this.repo.findById(input.id)
        : await this.repo.findByIdForUser({ id: input.id, userId: input.userId });

    if (!link) {
      throw new NotFoundException('Link de assinatura não encontrado');
    }

    const binding = await this.prisma.communityLinkBinding.findFirst({
      where: { subscriptionLinkId: link.id },
      select: { communityId: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: {
        id: link.id,
        codigo: link.code,
        nome: link.name,
        descricao: link.description ?? null,
        valor: Number(link.amount),
        frequencia: mapFreq(link.frequencyType),
        frequencyType: link.frequencyType,
        isStandalone: link.isStandalone,
        platformFee: link.platformFee,
        paymentMethods: link.paymentMethods,
        ownerEmail: link.ownerEmail ?? null,
        ativo: link.isActive,
        usos: link.currentUses,
        maxUsos: link.maxUses ?? null,
        redirectUrl: link.redirectUrl ?? null,
        webhookUrl: link.webhookUrl ?? null,
        communityId: binding?.communityId ?? null,
        platformTag: link.platformTag ?? null,
        plataformas: link.plataformas ?? [],
        criadoEm: link.createdAt.toISOString(),
      },
    };
  }
}

