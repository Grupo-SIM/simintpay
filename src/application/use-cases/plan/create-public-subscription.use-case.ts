import { assertExplicitPlatform, platformGatewayToken } from '../../helpers/explicit-platform.helper';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getModuleDomToken } from '../../../modules/module.registry';
import { EmailService } from '../../../infrastructure/email/email.service';
import { Optional } from '@nestjs/common';

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
  private readonly logger = new Logger(CreatePublicSubscriptionUseCase.name);

  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptions: ISubscriptionRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
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
    const domToken = platformGatewayToken(plan.plataformas?.[0] ?? owner?.tenantModule?.slug, process.env.DOM_TOKEN);
    if (!domToken) {
      throw new BadRequestException('Token do gateway não configurado');
    }

    const cleanDoc = input.customerDocument.replace(/\D/g, '');
    const cleanPhone = input.customerPhone.replace(/\D/g, '');

    const customer = await this.prisma.customer.upsert({
      where: {
        userId_document: {
          userId: plan.userId,
          document: cleanDoc,
        },
      },
      update: {
        name: input.customerName,
        email: input.customerEmail,
        phone: cleanPhone || undefined,
      },
      create: {
        userId: plan.userId,
        name: input.customerName,
        email: input.customerEmail,
        document: cleanDoc,
        documentType: cleanDoc.length === 14 ? 'CNPJ' : 'CPF',
        phone: cleanPhone || undefined,
      },
    });

    const subscriptionInput = {
      planId: plan.domPlanId,
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        document: cleanDoc,
        phone: cleanPhone,
        documentType: cleanDoc.length === 14 ? ('CNPJ' as const) : ('CPF' as const),
      },
      card: input.card,
    };

    const domResult = await this.gateway.createSubscriptionFromCheckout(domToken, subscriptionInput);

    const statusLower = (domResult.status ?? '').toString().toLowerCase();
    if (['inactive', 'cancelled', 'canceled', 'suspended'].includes(statusLower)) {
      throw new BadRequestException(
        'Pagamento não autorizado. Tente outro cartão ou forma de pagamento.',
      );
    }
    const VALID = ['active', 'pending', 'trial'];
    // Só enviamos o e-mail de acesso quando a cobrança foi efetivada (cartão aprovado)
    const VALID_PAID = ['active'];
    if (!VALID.includes(statusLower)) {
      throw new BadRequestException(
        `Assinatura recusada pelo gateway${domResult.status ? `: ${domResult.status}` : ''}.`,
      );
    }

    const saved = await this.subscriptions.create({
      userId: plan.userId,
      planId: plan.id,
      customerId: customer.id,
      status: (domResult.status as string) ?? 'active',
      domSubscriptionId: domResult.id,
    });

    this.logger.log(
      `Assinatura criada: subId=${saved.id}, domSubId=${domResult.id}, planId=${plan.id}`,
    );

    // E-mail de acesso personalizado (qualquer plataforma com corpo definido)
    if (
      this.emailService &&
      plan.emailBody?.trim() &&
      VALID_PAID.includes(statusLower)
    ) {
      try {
        await this.emailService.sendEbookAccessEmail({
          to: input.customerEmail,
          customerName: input.customerName,
          title: plan.name,
          body: plan.emailBody,
          redirectUrl: plan.redirectUrl ?? null,
        });
      } catch (err) {
        this.logger.error(`Falha ao enviar e-mail de ebook (plano ${plan.id}): ${String(err)}`);
      }
    }

    return {
      id: saved.id,
      status: saved.status,
      planId: plan.id,
      redirectUrl: plan.redirectUrl ?? null,
    };
  }
}
