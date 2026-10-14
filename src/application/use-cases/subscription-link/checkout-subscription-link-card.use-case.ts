import { getCustomerInterestRate } from '../../../modules/platform-taxas/platform-taxas.store';
import { assertExplicitPlatform, platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { CheckoutSubscriptionLinkCardDto } from '../../dtos/subscription-link/checkout-subscription-link.dto';
import { getModuleDomToken } from '../../../modules/module.registry';
import { CommunityManagementService } from '../../services/community-management.service';
import { EmailService } from '../../../infrastructure/email/email.service';
import { getPlatformTaxaEffective, buildClientTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { VoucherService } from '../voucher/voucher.service';
import { splitDocument } from '../../utils/document.util';
import { isAreaflixLink, calculateAreaflixSellerNet } from '../../helpers/areaflix-fees.helper';
import { advanceSubscriptionPeriod } from '../../helpers/subscription-period.helper';

function mapPlanFrequencyToDom(linkFrequency: string): { frequency_type: 'WEEK' | 'MONTH' | 'YEAR'; frequency: number } {
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
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly communities: CommunityManagementService,
    private readonly emailService: EmailService,
    private readonly voucherService: VoucherService,
  ) { }

  async execute(input: { code: string; dto: CheckoutSubscriptionLinkCardDto }) {
    const link = await this.repo.findByCode(input.code);
    if (!link || !link.isActive) throw new NotFoundException('Link de assinatura não encontrado ou inativo');
    if (link.maxUses != null && link.currentUses >= link.maxUses) {
      throw new BadRequestException('Limite de assinaturas atingido');
    }
    const owner = await this.users.findById(link.userId);
    const selectedTag = link.platformTag ?? link.plataformas?.[0] ?? owner?.platform?.tag ?? 'GLOBAL';
    const domToken = platformGatewayToken(selectedTag, process.env.DOM_TOKEN);
    if (!domToken) throw new BadRequestException('Token do gateway não configurado');

    let domPlanId = link.domPlanId;
    if (!domPlanId) {
      const planFreq = mapPlanFrequencyToDom(link.frequencyType);
      const syncedPlan = await this.gateway.createPlan(domToken, {
        price: Number(link.amount),
        description: link.name,
        frequency_type: planFreq.frequency_type,
        frequency: planFreq.frequency,
        repetitions: 0,
        retry_days: 3,
        webhookUrl: link.webhookUrl ?? undefined,
        redirectUrl: link.redirectUrl ?? undefined,
      });
      domPlanId = syncedPlan.id;
      await this.repo.update(link.id, { domPlanId });
    }

    const base = Number(link.amount);

    // Taxa de assinatura: hierarquia completa — override da plataforma → env var → GLOBAL → valor gravado no link
    let platformFeeRate: number;
    if (!link.isStandalone) {
      const slugTag = owner?.platform?.tag?.toUpperCase();
      // Plataforma: usa a selecionada no link (platformTag) → fallback platform → webhook heuristic
      const platformTag = selectedTag;
      // Taxa personalizada por cliente na SIM INT PAY (GLOBAL): tag CLIENT:<email> (cai no GLOBAL se não houver).
      const taxaTag = platformTag === 'GLOBAL' && input.dto.customerEmail?.trim()
        ? buildClientTaxaTag(input.dto.customerEmail)
        : platformTag;
      // Passa link.platformFee como fallback final: se nada estiver configurado no admin,
      // usa o valor que estava gravado no link. Se GLOBAL estiver configurado, GLOBAL prevalece.
      const mdrDom1x = getPlatformTaxaEffective(taxaTag, 'MDR_CC_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_1X);
      const mdrMaster1x = getCustomerInterestRate(taxaTag, 1);
      platformFeeRate = mdrDom1x + mdrMaster1x;
    } else {
      platformFeeRate = 0;
    }
    const platformFeeAmount = Math.round(base * platformFeeRate * 100) / 100;
    const initialAmountCharged = base + platformFeeAmount;

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

    const cleanDoc = input.dto.customerDocument.replace(/\D/g, '');
    const cleanPhone = (input.dto.customerPhone ?? '').replace(/\D/g, '');

    const domResult = await this.gateway.createSubscriptionFromCheckout(domToken, {
      planId: domPlanId,
      customer: {
        name: input.dto.customerName,
        email: input.dto.customerEmail,
        document: cleanDoc,
        phone: cleanPhone,
        documentType: cleanDoc.length === 14 ? 'CNPJ' : 'CPF',
      },
      card: input.dto.card,
    });

    // Alinhado à api-dom (subscription-link.service): cartão recusado / assinatura inválida na resposta síncrona
    const statusLower = (domResult.status ?? '').toString().toLowerCase();
    const cardNotAuthorized = ['inactive', 'cancelled', 'canceled', 'suspended'].includes(statusLower);
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

    const order = await this.repo.createOrder({
      subscriptionLinkId: link.id,
      userId: link.userId,
      customerName: input.dto.customerName,
      customerEmail: input.dto.customerEmail,
      customerDocument: cleanDoc,
      customerPhone: cleanPhone || null,
      paymentMethod: 'CREDIT_CARD',
      status: (domResult.status ?? 'pending').toLowerCase(),
      domSubscriptionId: domResult.id,
      amountCharged,
      platformFeeAmount,
      currentPeriodEndsAt: advanceSubscriptionPeriod(new Date(), link.frequencyType),
    });

    await this.repo.update(link.id, { currentUses: link.currentUses + 1 });

    const community = await this.communities.findBoundCommunityForSubscriptionLink(link.id);
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
      netAmount: isAreaflixLink({
        webhookUrl: link.webhookUrl,
        platformTag: (link as any).platformTag,
        plataformas: (link as any).plataformas,
      })
        ? calculateAreaflixSellerNet(amountCharged, 'CREDIT_CARD', 1)
        : Number((amountCharged - platformFeeAmount).toFixed(2)),
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
