import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  acceptsCard,
  acceptsPix,
  normalizeStoredPaymentMethods,
} from '../../helpers/accepted-payment-methods.helper';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../../../modules/financial-policy/financial-charge';
import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';

function mapFrequencyLabel(t: PlanType): string {
  switch (t) {
    case PlanType.TRIMESTRAL:
      return 'TRIMESTRAL';
    case PlanType.SEMESTRAL:
      return 'SEMESTRAL';
    case PlanType.ANUAL:
      return 'ANUAL';
    default:
      return 'MENSAL';
  }
}

@Injectable()
export class GetPublicSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY)
    private readonly repo: ISubscriptionLinkRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(code: string) {
    const link = await this.repo.findByCode(code);
    if (!link || !link.isActive) {
      throw new NotFoundException(
        'Link de assinatura não encontrado ou inativo',
      );
    }
    if (link.maxUses != null && link.currentUses >= link.maxUses) {
      throw new NotFoundException('Limite de assinaturas atingido');
    }

    // Valor que o comprador pagará (com ou sem taxa de assinatura da plataforma)
    const base = Number(link.amount);
    const platformTag = link.platformTag ?? link.plataformas?.[0] ?? 'GLOBAL';
    platformGatewayToken(platformTag, process.env.DOM_TOKEN);

    const context = await loadChargePolicy(this.prisma, platformTag);
    const quote = quoteFinancialCharge(context, base, 'CREDIT_CARD');
    const pixQuote = quoteFinancialCharge(context, base, 'PIX');
    if (acceptsCard(link.paymentMethods) && !quote)
      throw new BadRequestException(
        'Política financeira não configurada para cartão',
      );
    if (acceptsPix(link.paymentMethods) && !pixQuote)
      throw new BadRequestException(
        'Política financeira não configurada para PIX',
      );
    return {
      id: link.id,
      codigo: link.code,
      nome: link.name,
      descricao: link.description ?? null,
      valor: base,
      valorComJuros: quote?.totalAmount ?? base,
      valorPix: pixQuote?.totalAmount ?? base,
      platformFee: quote?.platformFeeRate ?? 0,
      isStandalone: link.isStandalone,
      frequencia: mapFrequencyLabel(link.frequencyType),
      ativo: link.isActive,
      redirectUrl: link.redirectUrl ?? null,
      platformTag: platformTag,
      paymentMethods: normalizeStoredPaymentMethods(link.paymentMethods),
      aceitaCartao: acceptsCard(link.paymentMethods),
      aceitaPix: acceptsPix(link.paymentMethods),
    };
  }
}
