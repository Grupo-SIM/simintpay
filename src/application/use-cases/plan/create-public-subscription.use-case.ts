import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import { SUBSCRIPTION_REPOSITORY } from '../../../core/repositories/subscription.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { ISubscriptionRepository } from '../../../core/repositories/subscription.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

export type CreatePublicSubscriptionInput = {
  planId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone: string;
  card: {
    token: string;
    brand?: string;
    bin?: string;
    exp_month: string;
    exp_year: string;
    cvv: string;
    holder_name: string;
    holder_document: string;
    number?: string;
  };
};

@Injectable()
export class CreatePublicSubscriptionUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptions: ISubscriptionRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: CreatePublicSubscriptionInput): Promise<{
    id: string;
    status: string;
    planId: string;
    redirectUrl: string | null;
  }> {
    const plan = await this.plans.findById(input.planId);
    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plano não encontrado ou inativo');
    }
    if (!plan.domPlanId) {
      throw new BadRequestException('Plano ainda não sincronizado com o gateway');
    }

    const owner = await this.users.findById(plan.userId);
    const domToken = owner?.domToken ?? process.env.DOM_TOKEN;
    if (!domToken) {
      throw new BadRequestException('Token do gateway não configurado');
    }

    const domResult = await this.gateway.createSubscriptionFromCheckout(domToken, {
      planId: plan.domPlanId,
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        document: input.customerDocument.replace(/\D/g, ''),
        phone: input.customerPhone.replace(/\D/g, ''),
      },
      card: input.card,
    });

    const saved = await this.subscriptions.create({
      userId: plan.userId,
      planId: plan.id,
      status: (domResult.status as string) ?? 'active',
      domSubscriptionId: domResult.id,
    });

    return {
      id: saved.id,
      status: saved.status,
      planId: plan.id,
      redirectUrl: plan.redirectUrl ?? null,
    };
  }
}
