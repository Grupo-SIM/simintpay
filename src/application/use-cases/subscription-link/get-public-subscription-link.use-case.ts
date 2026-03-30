import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';

function mapFrequencyLabel(t: PlanType): string {
  switch (t) {
    case PlanType.TRIMESTRAL: return 'TRIMESTRAL';
    case PlanType.SEMESTRAL:  return 'SEMESTRAL';
    case PlanType.ANUAL:      return 'ANUAL';
    default:                  return 'MENSAL';
  }
}

@Injectable()
export class GetPublicSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
  ) {}

  async execute(code: string) {
    const link = await this.repo.findByCode(code);
    if (!link || !link.isActive) {
      throw new NotFoundException('Link de assinatura não encontrado ou inativo');
    }
    if (link.maxUses != null && link.currentUses >= link.maxUses) {
      throw new NotFoundException('Limite de assinaturas atingido');
    }

    // Valor que o comprador pagará (com ou sem platformFee)
    const base = Number(link.amount);
    const valorComJuros = link.isStandalone
      ? base
      : Math.round(base * (1 + link.platformFee / 100) * 100) / 100;

    return {
      id: link.id,
      codigo: link.code,
      nome: link.name,
      descricao: link.description ?? null,
      valor: base,
      valorComJuros,
      platformFee: link.platformFee,
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
