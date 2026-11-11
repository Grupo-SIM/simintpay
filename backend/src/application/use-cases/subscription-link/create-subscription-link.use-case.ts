import { requireFinancialCharge } from '../../../modules/financial-policy/require-financial-charge';
import { resolveFinancialOwner } from '../../helpers/financial-owner.helper';
import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type {
  CreateSubscriptionLinkDto,
  FrequencyTypeDto,
} from '../../dtos/subscription-link/create-subscription-link.dto';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  assertClientCanCreate,
  clientTaxaTagFor,
} from '../../helpers/client-rules.helper';

// Frequências suportadas: apenas Semanal (WEEK), Mensal (MONTH) e Anual (YEAR) — os 3 tipos da DOM.
function mapFrequency(f: FrequencyTypeDto): {
  planType: PlanType;
  domFrequency: 'WEEK' | 'MONTH' | 'YEAR';
} {
  switch (f) {
    case 'SEMANAL':
      return { planType: PlanType.WEEKLY, domFrequency: 'WEEK' };
    case 'ANUAL':
      return { planType: PlanType.ANUAL, domFrequency: 'YEAR' };
    case 'MENSAL':
    default:
      return { planType: PlanType.MONTHLY, domFrequency: 'MONTH' };
  }
}

@Injectable()
export class CreateSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY)
    private readonly repo: ISubscriptionLinkRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: {
    userId: string;
    role?: string;
    dto: CreateSubscriptionLinkDto;
  }) {
    const {
      owner,
      platformTag: selectedTag,
      createdByUserId,
    } = await resolveFinancialOwner(this.users, input.userId, {
      ...input.dto,
      platforms: [
        ...(input.dto.plataformas ?? []),
        ...(input.dto.platformTag ? [input.dto.platformTag] : []),
      ],
    });
    const targetUserId = owner.id;
    const ownerEmail = owner.email;
    assertClientCanCreate(owner, input.dto.valor);
    const clientTag = clientTaxaTagFor(owner);

    const domToken = platformGatewayToken(selectedTag, process.env.DOM_TOKEN);
    if (!domToken)
      throw new BadRequestException('Token do gateway não configurado');

    const { planType, domFrequency } = mapFrequency(input.dto.frequencia);
    // Cliente: a taxa do cliente sempre incide → isStandalone=false (não-standalone aplica fee).
    const isStandalone =
      owner.clientStatus != null ? false : (input.dto.isStandalone ?? true);

    const platformTag = selectedTag ?? 'GLOBAL';
    const quote = await requireFinancialCharge(
      this.prisma,
      platformTag,
      input.dto.valor,
      'CREDIT_CARD',
    );
    const domPrice = quote.totalAmount;

    // Sempre precisa de plano DOM para checkout (cartão e PIX), inclusive quando isStandalone=true.
    const domPlan = await this.gateway.createPlan(domToken, {
      price: domPrice,
      description: input.dto.nome,
      frequency_type: domFrequency,
      frequency: 1,
      repetitions: 0,
      retry_days: 3,
      webhookUrl: input.dto.webhookUrl,
      redirectUrl: input.dto.redirectUrl,
    });

    const saved = await this.repo.create({
      coproduction: input.dto.coproduction,
      userId: targetUserId,
      createdByUserId,
      ownerEmail,
      name: input.dto.nome,
      description: input.dto.descricao ?? null,
      amount: input.dto.valor,
      frequencyType: planType,
      isStandalone,
      platformFee: quote.platformFeeRate,
      redirectUrl: input.dto.redirectUrl ?? null,
      webhookUrl: input.dto.webhookUrl ?? null,
      maxUses: input.dto.maxUses ?? null,
      domPlanId: domPlan.id,
      paymentMethods: input.dto.paymentMethods ?? 'BOTH',
      platformTag: selectedTag ?? null,
      emailBody: input.dto.emailBody ?? null,
      // Cliente SimintPay: atribui a plataforma "SIMINTPAY" (exibição/agrupamento) para o
      // master aplicar taxas via CLIENT:<email>. Mesmo padrão do link de pagamento e plano.
      plataformas: selectedTag ? [selectedTag] : clientTag ? ['SIMINTPAY'] : [],
    });

    return {
      data: {
        id: saved.id,
        codigo: saved.code,
        nome: saved.name,
        descricao: saved.description ?? null,
        valor: Number(saved.amount),
        frequencia: input.dto.frequencia,
        isStandalone: saved.isStandalone,
        platformFee: saved.platformFee,
        ativo: saved.isActive,
        criadoEm: saved.createdAt.toISOString(),
      },
    };
  }
}
