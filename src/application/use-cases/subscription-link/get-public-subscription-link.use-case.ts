import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
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
      // Mesma lógica de detecção de plataforma dos use cases de checkout:
      // 1º slugTag do tenantModule; 2º AREAFLIX se webhookUrl contiver 'areaflix'; 3º COMUNIDADE
      const isAreaflix = (link.webhookUrl ?? '').toLowerCase().includes('areaflix');
      const slugTag = owner?.tenantModule?.slug?.toUpperCase();
      const platformTag = slugTag ?? (isAreaflix ? 'AREAFLIX' : 'COMUNIDADE');
      // Mesma hierarquia dos use cases de checkout: plataforma → env var → GLOBAL → valor gravado no link.
      // Passar link.platformFee como fallback garante que, sem nenhuma configuração no admin,
      // o valor original do link é exibido. Com GLOBAL configurado, o GLOBAL prevalece.
      effectivePlatformFee = getPlatformTaxaEffective(
        platformTag,
        'TAXA_ASSINATURA',
        link.platformFee ?? PLATFORM_TAXA_DEFAULTS.TAXA_ASSINATURA,
      );
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
