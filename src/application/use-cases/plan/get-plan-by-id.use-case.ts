import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';

function mapPlanTypeToPt(
  tipo: PlanType,
): 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' {
  switch (tipo) {
    case PlanType.MONTHLY:
      return 'MENSAL';
    case PlanType.TRIMESTRAL:
      return 'TRIMESTRAL';
    case PlanType.SEMESTRAL:
      return 'SEMESTRAL';
    case PlanType.ANUAL:
    default:
      return 'ANUAL';
  }
}

@Injectable()
export class GetPlanByIdUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
  ) {}

  async execute(input: { userId: string; role: string; id: string }): Promise<{ data: unknown }> {
    let plan;

    if (input.role === 'ADMIN') {
      plan = await this.plans.findById(input.id);
    } else {
      plan = await this.plans.findByIdForUser({ id: input.id, userId: input.userId });
    }

    if (!plan) {
      throw new NotFoundException('Plano não encontrado');
    }

    return {
      data: {
        id: plan.id,
        nome: plan.name,
        descricao: plan.description ?? null,
        preco: Number(plan.price),
        tipo: mapPlanTypeToPt(plan.type),
        frequencia: 1,
        repeticoes: 0,
        diasRetentativa: 3,
        redirectUrl: plan.redirectUrl ?? null,
        webhookUrl: plan.webhookUrl ?? null,
        ativo: plan.isActive,
        emailBody: plan.emailBody ?? null,
        plataformas: plan.plataformas ?? [],
        criadoEm: plan.createdAt.toISOString(),
      },
    };
  }
}
