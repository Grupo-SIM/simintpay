import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';

function mapType(type: PlanType): string {
  switch (type) {
    case PlanType.MONTHLY: return 'MENSAL';
    case PlanType.TRIMESTRAL: return 'TRIMESTRAL';
    case PlanType.SEMESTRAL: return 'SEMESTRAL';
    case PlanType.ANUAL: return 'ANUAL';
    default: return 'MENSAL';
  }
}

@Injectable()
export class GetPublicPlanUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
  ) {}

  async execute(id: string): Promise<{
    id: string;
    nome: string;
    descricao: string | null;
    preco: number;
    tipo: string;
    ativo: boolean;
    plataformas: string[];
  }> {
    const plan = await this.plans.findById(id);
    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plano não encontrado ou inativo');
    }
    return {
      id: plan.id,
      nome: plan.name,
      descricao: plan.description ?? null,
      preco: Number(plan.price),
      tipo: mapType(plan.type),
      ativo: plan.isActive,
      plataformas: (plan as any).plataformas ?? [],
    };
  }
}
