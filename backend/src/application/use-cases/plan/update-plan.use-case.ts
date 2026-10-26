import { recoverPlanRecurrence } from '../../helpers/plan-recurrence.helper';
import { getCustomerInterestRate, getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { clientTaxaTagFor } from '../../helpers/client-rules.helper';
import { assertExplicitPlatform, platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { CreatePlanDto, PlanTipoDto } from '../../dtos/plan/create-plan.dto';

// Frequências suportadas: apenas Semanal (WEEKLY), Mensal (MONTHLY) e Anual (ANUAL).
function mapTipo(tipo: PlanTipoDto): PlanType {
  switch (tipo) {
    case 'SEMANAL':
      return PlanType.WEEKLY;
    case 'ANUAL':
      return PlanType.ANUAL;
    case 'MENSAL':
    default:
      return PlanType.MONTHLY;
  }
}

function mapPlanTypeToPt(tipo: PlanType): 'SEMANAL' | 'MENSAL' | 'ANUAL' {
  switch (tipo) {
    case PlanType.WEEKLY:
      return 'SEMANAL';
    case PlanType.ANUAL:
      return 'ANUAL';
    default:
      // MONTHLY (+ legado TRIMESTRAL/SEMESTRAL, que não são mais oferecidos)
      return 'MENSAL';
  }
}

@Injectable()
export class UpdatePlanUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  async execute(input: {
    userId: string;
    role: string;
    id: string;
    dto: Partial<CreatePlanDto> & { isActive?: boolean };
  }): Promise<{ data: unknown }> {
    let existing = input.role === 'ADMIN'
      ? await this.plans.findById(input.id)
      : await this.plans.findByIdForUser({ id: input.id, userId: input.userId });

    if (!existing) {
      throw new NotFoundException('Plano não encontrado');
    }

    if (input.role !== 'ADMIN' && existing.userId !== input.userId) {
      throw new UnauthorizedException('Sem permissão para editar este plano');
    }

    const hasTermsEdit = ['preco', 'tipo', 'frequencia', 'repeticoes', 'diasRetentativa'].some(key => input.dto[key as keyof typeof input.dto] !== undefined);
    if (hasTermsEdit && (existing.frequency == null || existing.repetitions == null || existing.retryDays == null)) {
      existing = await recoverPlanRecurrence(existing, this.plans, this.gateway);
    }

    const selectedTag = input.dto.plataformas !== undefined
      ? assertExplicitPlatform({ id: input.userId, role: input.role }, input.dto.plataformas, true)
      : existing.plataformas?.[0] ?? null;
    const price = input.dto.preco ?? Number(existing.price);
    const type = input.dto.tipo ? mapTipo(input.dto.tipo) : existing.type;
    const frequency = input.dto.frequencia ?? existing.frequency;
    const repetitions = input.dto.repeticoes ?? existing.repetitions;
    const retryDays = input.dto.diasRetentativa ?? existing.retryDays;
    const termsChanged = price !== Number(existing.price) || type !== existing.type ||
      (input.dto.frequencia !== undefined && frequency !== existing.frequency) ||
      (input.dto.repeticoes !== undefined && repetitions !== existing.repetitions) ||
      (input.dto.diasRetentativa !== undefined && retryDays !== existing.retryDays);
    let domPlanId = existing.domPlanId;
    if (termsChanged) {
      if (frequency == null || repetitions == null || retryDays == null) {
        throw new BadRequestException('Confirme frequência, repetições e dias de retentativa: dados antigos não foram armazenados');
      }
      if (!Number.isInteger(frequency) || frequency < 1 || !Number.isInteger(repetitions) || repetitions < 0 || !Number.isInteger(retryDays) || retryDays < 0) {
        throw new BadRequestException('Configuração de recorrência inválida');
      }
      const owner = await this.users.findById(existing.userId);
      const domToken = platformGatewayToken(selectedTag, process.env.DOM_TOKEN);
      if (!domToken) throw new BadRequestException('Token do gateway não configurado');
      const tag = selectedTag && !['GLOBAL', 'SIMINTPAY'].includes(selectedTag.toUpperCase())
        ? selectedTag : clientTaxaTagFor(owner) ?? 'GLOBAL';
      const cost = getPlatformTaxaEffective(tag, 'MDR_CC_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_1X);
      const interest = getCustomerInterestRate(tag, 1);
      const replacement = await this.gateway.createPlan(domToken, {
        price: Math.round(price * (1 + cost + interest) * 100) / 100,
        description: input.dto.nome ?? existing.name,
        frequency_type: type === PlanType.WEEKLY ? 'WEEK' : type === PlanType.ANUAL ? 'YEAR' : 'MONTH',
        frequency, repetitions, retry_days: retryDays,
      });
      // Existing subscriptions retain old gateway plan; public local ID/code stay stable.
      domPlanId = replacement.id;
    }
    const updated = await this.plans.update(input.id, {
      frequency, repetitions, retryDays, domPlanId,
      name: input.dto.nome ?? existing.name,
      description: input.dto.descricao ?? existing.description,
      price: input.dto.preco ?? Number(existing.price),
      type: input.dto.tipo ? mapTipo(input.dto.tipo) : existing.type,
      webhookUrl: input.dto.webhookUrl ?? existing.webhookUrl,
      redirectUrl: input.dto.redirectUrl ?? existing.redirectUrl,
      ...(input.dto.isActive !== undefined && { isActive: input.dto.isActive }),
      ...(input.dto.code !== undefined && { code: input.dto.code }),
      ...(input.dto.emailBody !== undefined && { emailBody: input.dto.emailBody }),
      ...(input.dto.plataformas !== undefined && { plataformas: selectedTag ? [selectedTag] : [] }),
    });

    return {
      data: {
        id: updated.id,
        nome: updated.name,
        descricao: updated.description ?? null,
        preco: Number(updated.price),
        tipo: mapPlanTypeToPt(updated.type),
        ativo: updated.isActive,
        redirectUrl: updated.redirectUrl ?? null,
        webhookUrl: updated.webhookUrl ?? null,
        criadoEm: updated.createdAt.toISOString(),
      },
    };
  }
}
