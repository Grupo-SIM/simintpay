import { BadRequestException } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import type { IPlanRepository } from '../../core/repositories/plan.repository.interface';
import type { IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { platformGatewayToken } from './explicit-platform.helper';

/** Recover legacy settings from the exact owned gateway plan; never guess its interval. */
export async function recoverPlanRecurrence(plan: Plan, repo: IPlanRepository, gateway: IPaymentGateway): Promise<Plan> {
  if (plan.frequency != null && plan.repetitions != null && plan.retryDays != null) return plan;
  if (!plan.domPlanId) throw new BadRequestException('Configuração de recorrência indisponível; plano sem identificação no gateway');
  const token = platformGatewayToken(plan.plataformas?.[0], process.env.DOM_TOKEN);
  if (!token) throw new BadRequestException('Token do gateway não configurado');
  const remote = (await gateway.listPlans(token)).find(item => item.id === plan.domPlanId);
  if (!remote || !Number.isInteger(remote.frequency) || Number(remote.frequency) < 1 ||
      !Number.isInteger(remote.repetitions) || Number(remote.repetitions) < 0 ||
      !Number.isInteger(remote.retry_days) || Number(remote.retry_days) < 0) {
    throw new BadRequestException('Gateway não retornou configuração completa de recorrência; tente novamente');
  }
  return repo.update(plan.id, { frequency: remote.frequency, repetitions: remote.repetitions, retryDays: remote.retry_days });
}
