import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { requireFinancialCharge } from '../../../modules/financial-policy/require-financial-charge';
import { resolveFinancialOwner } from '../../helpers/financial-owner.helper';
import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
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
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import {
  assertClientCanCreate,
  clientTaxaTagFor,
} from '../../helpers/client-rules.helper';

// Frequências suportadas: apenas Semanal (WEEK), Mensal (MONTH) e Anual (YEAR) — os 3 tipos da DOM.
function mapTipo(tipo: PlanTipoDto): {
  planType: PlanType;
  frequency: 'WEEK' | 'MONTH' | 'YEAR';
} {
  switch (tipo) {
    case 'SEMANAL':
      return { planType: PlanType.WEEKLY, frequency: 'WEEK' };
    case 'ANUAL':
      return { planType: PlanType.ANUAL, frequency: 'YEAR' };
    case 'MENSAL':
    default:
      return { planType: PlanType.MONTHLY, frequency: 'MONTH' };
  }
}

@Injectable()
export class CreatePlanUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: {
    userId: string;
    dto: CreatePlanDto;
  }): Promise<{ data: unknown }> {
    // Cliente SimintPay: bloqueia não-aprovado e exige mínimo.
    const {
      owner,
      platformTag: explicitPlatformTag,
      createdByUserId,
    } = await resolveFinancialOwner(this.users, input.userId, {
      ...input.dto,
      platforms: input.dto.plataformas,
    });
    assertClientCanCreate(owner, input.dto.preco);
    const clientTag = clientTaxaTagFor(owner);

    const { planType, frequency } = mapTipo(input.dto.tipo);

    // Resolve o total do comprador pela política financeira atual da plataforma.
    const domToken = platformGatewayToken(
      explicitPlatformTag,
      process.env.DOM_TOKEN,
    );
    if (!domToken)
      throw new UnauthorizedException('Token do gateway não configurado');
    const platformTag = explicitPlatformTag ?? 'GLOBAL';
    const quote = await requireFinancialCharge(
      this.prisma,
      platformTag,
      input.dto.preco,
      'CREDIT_CARD',
    );
    const domPrice = quote.totalAmount;

    const dom = await this.gateway.createPlan(domToken, {
      price: domPrice,
      description: input.dto.nome,
      frequency_type: frequency,
      // Multiplicador: "a cada N semanas/meses/anos". Padrão 1 (dto.frequencia sobrescreve se > 1).
      frequency:
        input.dto.frequencia && input.dto.frequencia > 1
          ? input.dto.frequencia
          : 1,
      repetitions: input.dto.repeticoes ?? 0,
      retry_days: input.dto.diasRetentativa ?? 3,
      webhookUrl: input.dto.webhookUrl,
      redirectUrl: input.dto.redirectUrl,
    });

    const saved = await this.plans.create({
      coproduction: input.dto.coproduction,
      userId: owner.id,
      createdByUserId,
      name: input.dto.nome,
      description: input.dto.descricao ?? null,
      price: input.dto.preco,
      type: planType,
      frequency: input.dto.frequencia ?? 1,
      repetitions: input.dto.repeticoes ?? 0,
      retryDays: input.dto.diasRetentativa ?? 3,
      isActive: true,
      webhookUrl: input.dto.webhookUrl ?? null,
      redirectUrl: input.dto.redirectUrl ?? null,
      domPlanId: dom.id,
      code: input.dto.code ?? null,
      emailBody: input.dto.emailBody ?? null,
      // Plataforma explícita (ex.: PAGATG) sempre prevalece. Só cai em "SIMINTPAY"
      // (exibição/agrupamento do cliente) quando nenhuma plataforma foi enviada —
      // a taxa nesse caso segue resolvendo por CLIENT:<email> (herda da SIM INT PAY/GLOBAL).
      plataformas: input.dto.plataformas?.length
        ? input.dto.plataformas
        : clientTag
          ? ['SIMINTPAY']
          : [],
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
