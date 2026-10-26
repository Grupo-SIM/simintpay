import { recoverPlanRecurrence } from '../../helpers/plan-recurrence.helper';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';

function mapPlanTypeToPt(
  tipo: PlanType,
): 'SEMANAL' | 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' {
  switch (tipo) {
    case PlanType.WEEKLY:
      return 'SEMANAL';
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
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
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

    if (input.role !== 'ADMIN') plan = await recoverPlanRecurrence(plan, this.plans, this.gateway);

    return {
      data: {
        id: plan.id,
        nome: plan.name,
        descricao: plan.description ?? null,
        preco: Number(plan.price),
        tipo: mapPlanTypeToPt(plan.type),
        frequencia: plan.frequency ?? null,
        repeticoes: plan.repetitions ?? null,
        diasRetentativa: plan.retryDays ?? null,
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
