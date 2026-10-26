import { assertExplicitPlatform, platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class DeletePlanUseCase {
  private readonly logger = new Logger(DeletePlanUseCase.name);

  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string; role?: string; id: string }): Promise<void> {
    // ADMIN (master) exclui qualquer plano, independente de quem criou.
    const plan = input.role === 'ADMIN'
      ? await this.plans.findById(input.id)
      : await this.plans.findByIdForUser({ id: input.id, userId: input.userId });
    if (!plan) throw new NotFoundException('Plano não encontrado');

    // Remoção na DOM é best-effort: se o plano já não existe lá (ou o DOM falha),
    // não bloqueia a exclusão local (mesmo padrão do delete de link).
    const domToken = platformGatewayToken((plan as any).plataformas?.[0], process.env.DOM_TOKEN);
    if (domToken && plan.domPlanId) {
      try {
        await this.gateway.deletePlan(domToken, plan.domPlanId);
      } catch (err: unknown) {
        this.logger.warn(
          `DOM deletePlan falhou para ${plan.domPlanId}: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    await this.plans.delete(plan.id);
  }
}
