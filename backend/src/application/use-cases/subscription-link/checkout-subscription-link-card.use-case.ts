import {
  captureCoproduction,
  withCoproduction,
} from '../../../modules/coproduction/coproduction.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../../../modules/financial-policy/financial-charge';
import { acceptsCard } from '../../helpers/accepted-payment-methods.helper';
import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { CheckoutSubscriptionLinkCardDto } from '../../dtos/subscription-link/checkout-subscription-link.dto';
import { CommunityManagementService } from '../../services/community-management.service';
import { EmailService } from '../../../infrastructure/email/email.service';
import { VoucherService } from '../voucher/voucher.service';
import { splitDocument } from '../../utils/document.util';
import { advanceSubscriptionPeriod } from '../../helpers/subscription-period.helper';
import { paymentTracking } from '../../../modules/platform-core/payment-tracking';

function mapPlanFrequencyToDom(linkFrequency: string): {
  frequency_type: 'WEEK' | 'MONTH' | 'YEAR';
  frequency: number;
} {
  // Frequências suportadas: Semanal (WEEK), Mensal (MONTH), Anual (YEAR) — os 3 tipos da DOM.
  switch (linkFrequency) {
    case 'WEEKLY':
    case 'SEMANAL':
      return { frequency_type: 'WEEK', frequency: 1 };
    case 'ANUAL':
    case 'YEAR':
      return { frequency_type: 'YEAR', frequency: 1 };
    default:
      return { frequency_type: 'MONTH', frequency: 1 };
  }
}

@Injectable()
export class CheckoutSubscriptionLinkCardUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY)
    private readonly repo: ISubscriptionLinkRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly communities: CommunityManagementService,
    private readonly emailService: EmailService,
    private readonly voucherService: VoucherService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { code: string; dto: CheckoutSubscriptionLinkCardDto }) {
    const link = await this.repo.findByCode(input.code);
    if (!link || !link.isActive)
      throw new NotFoundException(
        'Link de assinatura não encontrado ou inativo',
      );
    if (link.maxUses != null && link.currentUses >= link.maxUses) {
      throw new BadRequestException('Limite de assinaturas atingido');
    }
    if (!acceptsCard(link.paymentMethods)) {
      throw new BadRequestException(
        'Este link não aceita pagamento via cartão de crédito',
      );
    }
    const selectedTag = link.platformTag ?? link.plataformas?.[0] ?? 'GLOBAL';
    const domToken = platformGatewayToken(selectedTag, process.env.DOM_TOKEN);
    if (!domToken)
      throw new BadRequestException('Token do gateway não configurado');

    const context = await loadChargePolicy(this.prisma, selectedTag);
    const initialAmountCharged = Number(link.amount);
    let amountCharged = initialAmountCharged;
    if (input.dto.voucherCode) {
      const bridge = await this.voucherService.validateVoucher(link.userId, {
        code: input.dto.voucherCode,
        amount: initialAmountCharged,
        channel: 'PAGATG',
        planId: link.id,
      });

      if (bridge && bridge.valid) {
        amountCharged = bridge.finalAmount;
      } else {
        throw new BadRequestException('Cupom inválido ou expirado');
      }
    }

    // New financial subscriptions get a new gateway plan, preserving existing subscriptions and their prices.
    const financialQuote = quoteFinancialCharge(
      context,
      amountCharged,
      'CREDIT_CARD',
    );
    if (!financialQuote)
      throw new BadRequestException(
        'Política financeira não configurada para esta modalidade',
      );
    const platformFeeAmount = financialQuote.totalFeeAmount;
    amountCharged = financialQuote.totalAmount;
    const frequency = mapPlanFrequencyToDom(link.frequencyType);
    const plan = await this.gateway.createPlan(domToken, {
      price: amountCharged,
      description: link.name,
      ...frequency,
      repetitions: 0,
      retry_days: 3,
      webhookUrl: link.webhookUrl ?? undefined,
      redirectUrl: link.redirectUrl ?? undefined,
    });
    const domPlanId = plan.id;
    const coproduction = await captureCoproduction(
      this.prisma,
      'links-assinatura',
      link.id,
      link.userId,
      selectedTag,
    );
    const coproductionFinancialSnapshot = withCoproduction(
      financialQuote.financialSnapshot,
      coproduction,
    );
    const cleanDoc = input.dto.customerDocument.replace(/\D/g, '');
    const cleanPhone = (input.dto.customerPhone ?? '').replace(/\D/g, '');

    let order = await this.repo.createOrder({
      subscriptionLinkId: link.id,
      userId: link.userId,
      customerName: input.dto.customerName,
      customerEmail: input.dto.customerEmail,
      customerDocument: cleanDoc,
      customerPhone: cleanPhone || null,
      tracking: paymentTracking(input.dto.tracking),
      paymentMethod: 'CREDIT_CARD',
      status: 'pending',
      amountCharged,
      platformFeeAmount,
      ...(coproductionFinancialSnapshot
        ? { financialSnapshot: coproductionFinancialSnapshot }
        : {}),
      currentPeriodEndsAt: advanceSubscriptionPeriod(
        new Date(),
        link.frequencyType,
      ),
    });

    const domResult = await this.gateway
      .createSubscriptionFromCheckout(domToken, {
        planId: domPlanId,
        customer: {
          name: input.dto.customerName,
          email: input.dto.customerEmail,
          document: cleanDoc,
          phone: cleanPhone,
          documentType: cleanDoc.length === 14 ? 'CNPJ' : 'CPF',
        },
        card: input.dto.card,
      })
      .catch(async (error: unknown) => {
        await this.prisma.subscriptionLinkOrder.update({
          where: { id: order.id },
          data: { status: 'failed' },
        });
        throw error;
      });

    // Alinhado à api-dom (subscription-link.service): cartão recusado / assinatura inválida na resposta síncrona
    const statusLower = (domResult.status ?? '').toString().toLowerCase();
    order = await this.prisma.subscriptionLinkOrder.update({
      where: { id: order.id },
      data: { status: statusLower, domSubscriptionId: domResult.id },
    });
    const cardNotAuthorized = [
      'inactive',
      'cancelled',
      'canceled',
      'suspended',
    ].includes(statusLower);
    if (cardNotAuthorized) {
      throw new BadRequestException(
        'Pagamento não autorizado. Tente outro cartão ou forma de pagamento.',
      );
    }

    const VALID = ['active', 'pending', 'trial'];
    if (!VALID.includes(statusLower)) {
      throw new BadRequestException(
        `Assinatura recusada pelo gateway${domResult.status ? `: ${domResult.status}` : ''}.`,
      );
    }

    await this.repo.update(link.id, { currentUses: link.currentUses + 1 });

    const community =
      await this.communities.findBoundCommunityForSubscriptionLink(link.id);
    if (community) {
      await this.communities.activateOrRenewCommunityAccess({
        communityId: community.id,
        userId: link.userId,
        frequencyType: link.frequencyType,
        paymentMethod: 'CREDIT_CARD',
        amountCharged,
        subscriptionLinkOrderId: order.id,
      });
    }

    try {
      if (link.emailBody?.trim()) {
        await this.emailService.sendEbookAccessEmail({
          to: input.dto.customerEmail,
          customerName: input.dto.customerName,
          title: link.name,
          body: link.emailBody,
          redirectUrl: link.redirectUrl ?? null,
        });
      } else {
        await this.emailService.sendSubscriptionAccess({
          to: input.dto.customerEmail,
          customerName: input.dto.customerName,
          linkName: link.name,
          redirectUrl: link.redirectUrl ?? null,
          orderId: order.id,
        });
      }
    } catch {
      // Email failure must not block the checkout response
    }

    // Notificar webhook externo configurado no link (ex: saas-netflix-back para atualizar plano do usuário)
    void notifyExternalWebhook(link.webhookUrl ?? null, {
      event: 'subscription_activated',
      customerEmail: input.dto.customerEmail,
      customerName: input.dto.customerName,
      planName: link.name,
      paymentMethod: 'CREDIT_CARD',
      frequencyType: link.frequencyType,
      amountCharged,
      netAmount: financialQuote.netAmount,
      orderId: order.id,
      linkId: link.id,
      ...splitDocument(cleanDoc),
      phone: cleanPhone || undefined,
    });

    return {
      id: order.id,
      status: order.status,
      redirectUrl: link.redirectUrl ?? null,
    };
  }
}

async function notifyExternalWebhook(
  webhookUrl: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!webhookUrl) return;
  const token = process.env.SIMPAY_WEBHOOK_TOKEN ?? '';
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-simpay-token': token,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Falha no webhook externo não bloqueia o fluxo
  }
}
