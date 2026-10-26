import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { captureCoproduction, withCoproduction } from '../../../modules/coproduction/coproduction.service';
import { calculateSellerNetValue } from '../../helpers/transaction-fee.helper';
import { loadChargePolicy, quoteFinancialCharge } from '../../../modules/financial-policy/financial-charge';
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
    const domToken = platformGatewayToken(plan.plataformas?.[0] ?? owner?.platform?.tag, process.env.DOM_TOKEN);
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

    const financialQuote = quoteFinancialCharge(await loadChargePolicy(this.prisma, plan.plataformas?.[0] ?? owner?.platform?.tag ?? 'GLOBAL'), Number(plan.price), 'CREDIT_CARD');
    let gatewayPlanId = plan.domPlanId;
    if (financialQuote) {
      const synced = await this.gateway.createPlan(domToken, { price: financialQuote.totalAmount, description: plan.name,
        frequency_type: plan.type === 'WEEKLY' ? 'WEEK' : plan.type === 'ANUAL' ? 'YEAR' : 'MONTH',
        frequency: plan.frequency ?? 1, repetitions: plan.repetitions ?? 0, retry_days: plan.retryDays ?? 3 });
      gatewayPlanId = synced.id;
    }
    const coproduction = await captureCoproduction(this.prisma, 'planos', plan.id, plan.userId, plan.plataformas?.[0] ?? owner?.platform?.tag ?? 'GLOBAL');
    const legacyPrice = Number(plan.price);
    const policyTag = plan.plataformas?.[0] ?? owner?.platform?.tag ?? 'GLOBAL';
    const legacyDomFee = Math.round(legacyPrice * getPlatformTaxaEffective(policyTag, 'MDR_CC_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_1X) * 100) / 100;
    const legacyNet = Number(calculateSellerNetValue(legacyPrice, 1, policyTag, 'credit_card').sub(legacyDomFee).toFixed(2));
    const coproductionFinancialSnapshot = withCoproduction(financialQuote?.financialSnapshot, coproduction, {
      totalAmount: legacyPrice, netAmount: legacyNet, totalFeeAmount: Math.round((legacyPrice - legacyNet) * 100) / 100,
      domFeeAmount: legacyDomFee, platformProfit: Math.round((legacyPrice - legacyNet - legacyDomFee) * 100) / 100, policyTag,
    });
    const subscriptionInput = {
      planId: gatewayPlanId,
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        document: cleanDoc,
        phone: cleanPhone,
        documentType: cleanDoc.length === 14 ? ('CNPJ' as const) : ('CPF' as const),
      },
      card: input.card,
    };

    let saved = await this.subscriptions.create({
      userId: plan.userId,
      planId: plan.id,
      customerId: customer.id,
      status: 'pending',
      ...(coproductionFinancialSnapshot ? { financialSnapshot: coproductionFinancialSnapshot } : {}),
    });

    const domResult = await this.gateway.createSubscriptionFromCheckout(domToken, subscriptionInput).catch(async (error: unknown) => { await this.prisma.subscription.update({ where: { id: saved.id }, data: { status: 'failed' } }); throw error; });

    const statusLower = (domResult.status ?? '').toString().toLowerCase();
    saved = await this.prisma.subscription.update({ where: { id: saved.id }, data: { status: statusLower, domSubscriptionId: domResult.id } });
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
