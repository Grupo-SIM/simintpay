import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { UpdateSubscriptionLinkDto } from '../../dtos/subscription-link/update-subscription-link.dto';
import { CommunityManagementService } from '../../services/community-management.service';

/** Converte a frequência do form (MENSAL/TRIMESTRAL/...) para o enum PlanType. */
function frequenciaToPlanType(f: string): PlanType {
  switch (f.toUpperCase()) {
    case 'TRIMESTRAL': return PlanType.TRIMESTRAL;
    case 'SEMESTRAL': return PlanType.SEMESTRAL;
    case 'ANUAL': return PlanType.ANUAL;
    case 'MONTHLY':
    case 'MENSAL':
    default: return PlanType.MONTHLY;
  }
}

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

    const newAmount = input.dto.valor ?? Number(existing.amount);
    const newFrequency = input.dto.frequencia
      ? frequenciaToPlanType(input.dto.frequencia)
      : (existing as any).frequencyType;

    // Se valor ou frequência mudaram, o plano gravado na DOM (domPlanId) fica desatualizado:
    // o checkout de CARTÃO recriaria a assinatura usando o preço/ciclo ANTIGOS. Zeramos o
    // domPlanId para que o próximo checkout de cartão recrie o plano na DOM com os valores
    // novos. (Assinantes atuais continuam no plano antigo; novos assinam pelo plano novo.)
    const planChanged =
      (input.dto.valor !== undefined && newAmount !== Number(existing.amount)) ||
      (input.dto.frequencia !== undefined && newFrequency !== (existing as any).frequencyType);

    const updated = await this.repo.update(existing.id, {
      name: input.dto.nome ?? existing.name,
      description: input.dto.descricao ?? existing.description,
      amount: newAmount,
      frequencyType: newFrequency,
      paymentMethods: input.dto.paymentMethods ?? (existing as any).paymentMethods,
      isActive: nextIsActive,
      isStandalone: input.dto.isStandalone ?? existing.isStandalone,
      platformFee: input.dto.platformFee ?? existing.platformFee,
      redirectUrl: input.dto.redirectUrl ?? existing.redirectUrl,
      webhookUrl: input.dto.webhookUrl ?? existing.webhookUrl,
      maxUses: input.dto.maxUses ?? existing.maxUses,
      platformTag: input.dto.platformTag !== undefined ? input.dto.platformTag : (existing as any).platformTag,
      ...(planChanged && (existing as any).domPlanId ? { domPlanId: null } : {}),
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
