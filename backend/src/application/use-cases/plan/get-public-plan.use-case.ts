import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { loadChargePolicy, quoteFinancialCharge } from '../../../modules/financial-policy/financial-charge';
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
    private readonly prisma: PrismaService,
  ) {}

  async execute(id: string): Promise<{
    id: string;
    nome: string;
    descricao: string | null;
    preco: number;
    originalPrice: number;
    paymentTotals: { CREDIT_CARD: number; PIX: number };
    tipo: string;
    ativo: boolean;
    plataformas: string[];
  }> {
    const plan = await this.plans.findById(id);
    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plano não encontrado ou inativo');
    }
    const context = await loadChargePolicy(this.prisma, plan.plataformas?.[0] ?? 'GLOBAL');
    const quote = quoteFinancialCharge(context, Number(plan.price), 'CREDIT_CARD');
    const pixQuote = quoteFinancialCharge(context, Number(plan.price), 'PIX');
    return {
      id: plan.id,
      nome: plan.name,
      descricao: plan.description ?? null,
      preco: quote?.totalAmount ?? Number(plan.price),
      originalPrice: Number(plan.price),
      paymentTotals: { CREDIT_CARD: quote?.totalAmount ?? Number(plan.price), PIX: pixQuote?.totalAmount ?? Number(plan.price) },
      tipo: mapType(plan.type),
      ativo: plan.isActive,
      plataformas: (plan as any).plataformas ?? [],
    };
  }
}
