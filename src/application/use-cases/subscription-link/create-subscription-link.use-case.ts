import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { CreateSubscriptionLinkDto, FrequencyTypeDto } from '../../dtos/subscription-link/create-subscription-link.dto';
import { getModuleDomToken } from '../../../modules/module.registry';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { CommunityManagementService } from '../../services/community-management.service';

function mapFrequency(f: FrequencyTypeDto): {
  planType: PlanType;
  domFrequency: 'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR';
} {
  switch (f) {
    case 'TRIMESTRAL': return { planType: PlanType.TRIMESTRAL, domFrequency: 'QUARTER' };
    case 'SEMESTRAL':  return { planType: PlanType.SEMESTRAL,  domFrequency: 'SEMESTER' };
    case 'ANUAL':      return { planType: PlanType.ANUAL,      domFrequency: 'YEAR' };
    default:           return { planType: PlanType.MONTHLY,    domFrequency: 'MONTH' };
  }
}

@Injectable()
export class CreateSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
    private readonly communities: CommunityManagementService,
  ) {}

  async execute(input: { userId: string; role?: string; dto: CreateSubscriptionLinkDto }) {
    let targetUserId = input.userId;
    let ownerEmail: string | null = null;

    // Admin criando link para outra conta: resolve userId pelo email informado
    if (input.role === 'ADMIN' && input.dto.email) {
      const targetUser = await this.prisma.user.findUnique({
        where: { email: input.dto.email },
        select: { id: true, email: true },
      });
      if (!targetUser) {
        throw new NotFoundException(`Usuário com email "${input.dto.email}" não encontrado`);
      }
      targetUserId = targetUser.id;
      ownerEmail = targetUser.email;
    }

    const owner = await this.users.findById(targetUserId);
    let domToken: string | null | undefined = owner?.domToken;
    if (!domToken && owner?.tenantModule?.slug) domToken = getModuleDomToken(owner.tenantModule.slug);
    if (!domToken) domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new BadRequestException('Token do gateway não configurado');

    const { planType, domFrequency } = mapFrequency(input.dto.frequencia);
    const isStandalone = input.dto.isStandalone ?? true;

    // Sempre precisa de plano DOM para checkout (cartão e PIX), inclusive quando isStandalone=true.
    const domPlan = await this.gateway.createPlan(domToken, {
      price: input.dto.valor,
      description: input.dto.nome,
      frequency_type: domFrequency,
      frequency: 1,
      repetitions: 0,
      retry_days: 3,
      webhookUrl: input.dto.webhookUrl,
      redirectUrl: input.dto.redirectUrl,
    });

    const saved = await this.repo.create({
      userId: targetUserId,
      ownerEmail,
      name: input.dto.nome,
      description: input.dto.descricao ?? null,
      amount: input.dto.valor,
      frequencyType: planType,
      isStandalone,
      platformFee: input.dto.platformFee ?? 9.0,
      redirectUrl: input.dto.redirectUrl ?? null,
      webhookUrl: input.dto.webhookUrl ?? null,
      maxUses: input.dto.maxUses ?? null,
      domPlanId: domPlan.id,
      paymentMethods: input.dto.paymentMethods ?? 'BOTH',
    });

    // Regra de negócio: link de assinatura NUNCA cria comunidade automaticamente.
    // Apenas vincula quando communityId é informado no cadastro.
    if (input.dto.communityId) {
      await this.communities.bindSubscriptionLinkManually({
        communityId: input.dto.communityId,
        subscriptionLinkId: saved.id,
      });
    }

    return {
      data: {
        id: saved.id,
        codigo: saved.code,
        nome: saved.name,
        descricao: saved.description ?? null,
        valor: Number(saved.amount),
        frequencia: input.dto.frequencia,
        isStandalone: saved.isStandalone,
        platformFee: saved.platformFee,
        ativo: saved.isActive,
        criadoEm: saved.createdAt.toISOString(),
      },
    };
  }
}
