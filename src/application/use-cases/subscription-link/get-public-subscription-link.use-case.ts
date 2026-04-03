import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { getPlatformTaxaEffective, getPlatformTaxaSource } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

function mapFrequencyLabel(t: PlanType): string {
  switch (t) {
    case PlanType.TRIMESTRAL: return 'TRIMESTRAL';
    case PlanType.SEMESTRAL: return 'SEMESTRAL';
    case PlanType.ANUAL: return 'ANUAL';
    default: return 'MENSAL';
  }
}

@Injectable()
export class GetPublicSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) { }

  async execute(code: string) {
    const link = await this.repo.findByCode(code);
    if (!link || !link.isActive) {
      throw new NotFoundException('Link de assinatura não encontrado ou inativo');
    }
    if (link.maxUses != null && link.currentUses >= link.maxUses) {
      throw new NotFoundException('Limite de assinaturas atingido');
    }

    // Valor que o comprador pagará (com ou sem taxa de assinatura da plataforma)
    const base = Number(link.amount);
    let effectivePlatformFee = link.platformFee; // fallback: valor gravado no link

    if (!link.isStandalone) {
      const owner = await this.users.findById(link.userId);
      const platformTag = owner?.tenantModule?.slug?.toUpperCase() ?? 'GLOBAL';
      const source = getPlatformTaxaSource(platformTag, 'TAXA_ASSINATURA');
      if (source === 'override' || source === 'env') {
        // TAXA_ASSINATURA está em % direto (ex: 9.0 = 9%)
        effectivePlatformFee = getPlatformTaxaEffective(platformTag, 'TAXA_ASSINATURA', PLATFORM_TAXA_DEFAULTS.TAXA_ASSINATURA);
      }
    }

    const valorComJuros = link.isStandalone
      ? base
      : Math.round(base * (1 + effectivePlatformFee / 100) * 100) / 100;

    return {
      id: link.id,
      codigo: link.code,
      nome: link.name,
      descricao: link.description ?? null,
      valor: base,
      valorComJuros,
      platformFee: effectivePlatformFee,
      isStandalone: link.isStandalone,
      frequencia: mapFrequencyLabel(link.frequencyType),
      ativo: link.isActive,
      redirectUrl: link.redirectUrl ?? null,
      paymentMethods: (link.paymentMethods as string | undefined) ?? 'BOTH',
      aceitaCartao: ((link.paymentMethods as string | undefined) ?? 'BOTH') !== 'PIX',
      aceitaPix: ((link.paymentMethods as string | undefined) ?? 'BOTH') !== 'CREDIT_CARD',
    };
  }
}
