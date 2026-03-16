import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type {
  CreatePlanDto,
  PlanTipoDto,
} from '../../dtos/plan/create-plan.dto';

function mapTipo(tipo: PlanTipoDto): {
  planType: PlanType;
  frequency: 'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR';
} {
  switch (tipo) {
    case 'MENSAL':
      return { planType: PlanType.MONTHLY, frequency: 'MONTH' };
    case 'TRIMESTRAL':
      return { planType: PlanType.TRIMESTRAL, frequency: 'QUARTER' };
    case 'SEMESTRAL':
      return { planType: PlanType.SEMESTRAL, frequency: 'SEMESTER' };
    case 'ANUAL':
    default:
      return { planType: PlanType.ANUAL, frequency: 'YEAR' };
  }
}

@Injectable()
export class CreatePlanUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: {
    userId: string;
    dto: CreatePlanDto;
  }): Promise<{ data: unknown }> {
    const user = await this.users.findById(input.userId);
    if (!user?.domToken) {
      throw new UnauthorizedException('Usuário não autenticado na api-dom');
    }

    const { planType, frequency } = mapTipo(input.dto.tipo);

    const dom = await this.gateway.createPlan(user.domToken, {
      price: input.dto.preco,
      description: `${input.dto.nome}${input.dto.descricao ? ` - ${input.dto.descricao}` : ''}`,
      frequency_type: frequency,
      webhookUrl: input.dto.webhookUrl,
      redirectUrl: input.dto.redirectUrl,
    });

    const saved = await this.plans.create({
      userId: input.userId,
      name: input.dto.nome,
      description: input.dto.descricao ?? null,
      price: input.dto.preco,
      type: planType,
      isActive: true,
      webhookUrl: input.dto.webhookUrl ?? null,
      redirectUrl: input.dto.redirectUrl ?? null,
      domPlanId: dom.id,
    });

    return {
      data: {
        id: saved.id,
        nome: saved.name,
        descricao: saved.description ?? null,
        preco: Number(saved.price),
        tipo: input.dto.tipo,
        ativo: saved.isActive,
        webhookUrl: saved.webhookUrl ?? null,
        redirectUrl: saved.redirectUrl ?? null,
        criadoEm: saved.createdAt.toISOString(),
      },
    };
  }
}
