import { Inject, Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class DeletePlanUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string; id: string }): Promise<void> {
    const plan = await this.plans.findByIdForUser({
      id: input.id,
      userId: input.userId,
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');

    const domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new InternalServerErrorException('DOM_TOKEN não configurado');

    if (plan.domPlanId) {
      await this.gateway.deletePlan(domToken, plan.domPlanId);
    }

    await this.plans.delete(plan.id);
  }
}
