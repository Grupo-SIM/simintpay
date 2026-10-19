import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { loadChargePolicy, quoteFinancialCharge } from '../../../modules/financial-policy/financial-charge';
import { assertExplicitPlatform, platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { getModuleDomToken } from '../../../modules/module.registry';

function mapTypeLabel(type: PlanType): string {
  switch (type) {
    case PlanType.TRIMESTRAL: return 'TRIMESTRAL';
    case PlanType.SEMESTRAL: return 'SEMESTRAL';
    case PlanType.ANUAL: return 'ANUAL';
    default: return 'MENSAL';
  }
}

function mapTypeFrequency(type: PlanType): number {
  switch (type) {
    case PlanType.TRIMESTRAL: return 3;
    case PlanType.SEMESTRAL: return 6;
    case PlanType.ANUAL: return 12;
    default: return 1;
  }
}

@Injectable()
export class GetPublicPlanByCodeUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(code: string) {
    // Tenta por code primeiro, depois por id (UUID) como fallback
    let plan = await this.plans.findByCode(code);
    if (!plan) {
      plan = await this.plans.findById(code);
    }
    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plano não encontrado ou inativo');
    }

    const owner = await this.users.findById(plan.userId);
    const domToken = platformGatewayToken(plan.plataformas?.[0] ?? owner?.platform?.tag, process.env.DOM_TOKEN);

    const frequencyType = mapTypeLabel(plan.type);
    const frequency = mapTypeFrequency(plan.type);

    // Build paymentMethods array from stored value
    // CREDIT_CARD = credit card only; PIX = pix only; BOTH (or null) = both options
    const pm = (plan as any).paymentMethods as string | null | undefined;
    let paymentMethods: string[];
    if (pm === 'CREDIT_CARD') {
      paymentMethods = ['CREDIT_CARD'];
    } else if (pm === 'PIX') {
      paymentMethods = ['PIX'];
    } else {
      paymentMethods = ['CREDIT_CARD', 'PIX'];
    }

    const context = await loadChargePolicy(this.prisma, plan.plataformas?.[0] ?? owner?.platform?.tag ?? 'GLOBAL');
    const quote = quoteFinancialCharge(context, Number(plan.price), 'CREDIT_CARD');
    const pixQuote = quoteFinancialCharge(context, Number(plan.price), 'PIX');
    return {
      id: plan.id,
      planId: plan.id,
      token: domToken ?? null,
      plan: {
        description: plan.name,
        value: quote?.totalAmount ?? Number(plan.price),
        originalPrice: Number(plan.price),
        paymentTotals: { CREDIT_CARD: quote?.totalAmount ?? Number(plan.price), PIX: pixQuote?.totalAmount ?? Number(plan.price) },
        frequencyType,
        frequency,
        paymentMethods,
        redirectUrl: plan.redirectUrl ?? null,
      },
    };
  }
}
