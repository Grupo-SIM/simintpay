import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type {
  CreatePlanDto,
  PlanTipoDto,
} from '../../dtos/plan/create-plan.dto';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

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
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: {
    userId: string;
    dto: CreatePlanDto;
  }): Promise<{ data: unknown }> {
    const domToken = process.env.DOM_TOKEN;
    if (!domToken) {
      throw new UnauthorizedException('DOM_TOKEN não configurado');
    }

    const { planType, frequency } = mapTipo(input.dto.tipo);

    // Preço que o cliente do cliente paga = base + taxa DOM cartão 1x + taxa Master cartão 1x
    // O preço base (sem markup) fica salvo no DB para cálculo de taxas do vendedor no webhook
    const platformTag = (input.dto.plataformas?.[0] ?? 'GLOBAL').toUpperCase();
    const mdrDom1x = getPlatformTaxaEffective(platformTag, 'MDR_CC_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_1X);
    const mdrMaster1x = getPlatformTaxaEffective(platformTag, 'MDR_CC_MASTER_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_MASTER_1X);
    const domPrice = Math.round(input.dto.preco * (1 + mdrDom1x + mdrMaster1x) * 100) / 100;

    const dom = await this.gateway.createPlan(domToken, {
      price: domPrice,
      description: input.dto.nome,
      frequency_type: frequency,
      frequency: input.dto.frequencia ?? 1,
      repetitions: input.dto.repeticoes ?? 0,
      retry_days: input.dto.diasRetentativa ?? 3,
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
      code: input.dto.code ?? null,
      plataformas: input.dto.plataformas ?? [],
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
