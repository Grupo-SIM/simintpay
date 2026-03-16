import { Inject, Injectable } from '@nestjs/common';
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
export class ListPlansUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
  ) {}

  async execute(input: { userId: string }): Promise<{ data: unknown }> {
    const items = await this.plans.findManyByUserId(input.userId);

    return {
      data: items.map((p) => ({
        id: p.id,
        nome: p.name,
        descricao: p.description ?? null,
        preco: Number(p.price),
        tipo: mapPlanTypeToPt(p.type),
        ativo: p.isActive,
        webhookUrl: p.webhookUrl ?? null,
        redirectUrl: p.redirectUrl ?? null,
        criadoEm: p.createdAt.toISOString(),
      })),
    };
  }
}
