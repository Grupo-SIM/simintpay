import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { CreateSubscriptionLinkDto, FrequencyTypeDto } from '../../dtos/subscription-link/create-subscription-link.dto';
import { getModuleDomToken } from '../../../modules/module.registry';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { CommunityManagementService } from '../../services/community-management.service';
import { assertClientCanCreate, clientTaxaTagFor } from '../../helpers/client-rules.helper';

// Frequências suportadas: apenas Semanal (WEEK), Mensal (MONTH) e Anual (YEAR) — os 3 tipos da DOM.
function mapFrequency(f: FrequencyTypeDto): {
  planType: PlanType;
  domFrequency: 'WEEK' | 'MONTH' | 'YEAR';
} {
  switch (f) {
    case 'SEMANAL': return { planType: PlanType.WEEKLY, domFrequency: 'WEEK' };
    case 'ANUAL':   return { planType: PlanType.ANUAL,  domFrequency: 'YEAR' };
    case 'MENSAL':
    default:        return { planType: PlanType.MONTHLY, domFrequency: 'MONTH' };
  }
}

@Injectable()
export class CreateSubscriptionLinkUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
    private readonly communities: CommunityManagementService,
  ) {}

  async execute(input: { userId: string; role?: string; dto: CreateSubscriptionLinkDto }) {
    let targetUserId = input.userId;
    let ownerEmail: string | null = null;

    // Admin criando link para outra conta: resolve userId pelo email informado
    if (input.role === 'ADMIN' && input.dto.email) {
      const targetUser = await this.prisma.user.findUnique({
        where: { email: input.dto.email },
        select: { id: true, email: true },
      });
      if (!targetUser) {
        throw new NotFoundException(`Usuário com email "${input.dto.email}" não encontrado`);
      }
      targetUserId = targetUser.id;
      ownerEmail = targetUser.email;
    }

    const owner = await this.users.findById(targetUserId);

    // Cliente SimintPay: bloqueia não-aprovado e exige mínimo.
    assertClientCanCreate(owner, input.dto.valor);
    const clientTag = clientTaxaTagFor(owner);

    // Areaflix usa o usuário admin (adminljl) como dono do link; o domToken dele
    // no banco pode estar expirado e causa 401 na DOM. Força o master key do env.
    const isAreaflixLink =
      (input.dto.webhookUrl ?? '').toLowerCase().includes('areaflix') ||
      input.dto.platformTag?.toUpperCase() === 'AREAFLIX' ||
      (input.dto.plataformas ?? []).some((p) => p?.toUpperCase() === 'AREAFLIX');
    // Cliente SimintPay SEMPRE usa o token mestre (SimintPay), ignorando token pessoal.
    let domToken: string | null | undefined = (clientTag || isAreaflixLink)
      ? process.env.DOM_TOKEN
      : owner?.domToken;
    if (!domToken && !clientTag && owner?.tenantModule?.slug) domToken = getModuleDomToken(owner.tenantModule.slug);
    if (!domToken) domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new BadRequestException('Token do gateway não configurado');

    const { planType, domFrequency } = mapFrequency(input.dto.frequencia);
    // Cliente: a taxa do cliente sempre incide → isStandalone=false (não-standalone aplica fee).
    const isStandalone = clientTag ? false : (input.dto.isStandalone ?? true);

    // Preço que o DOM cobrará do cliente no cartão = base × (1 + MDR_CC_1X + MDR_CC_MASTER_1X)
    // Cliente: resolve a taxa pela tag CLIENT:<email> (herda do GLOBAL).
    const platformTag = clientTag ?? (input.dto.platformTag ?? input.dto.plataformas?.[0] ?? 'GLOBAL').toUpperCase();
    let domPrice = input.dto.valor;
    if (!isStandalone) {
      const mdrDom1x = getPlatformTaxaEffective(platformTag, 'MDR_CC_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_1X);
      const mdrMaster1x = getPlatformTaxaEffective(platformTag, 'MDR_CC_MASTER_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_MASTER_1X);
      domPrice = Math.round(input.dto.valor * (1 + mdrDom1x + mdrMaster1x) * 100) / 100;
    }

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
      userId: targetUserId,
      ownerEmail,
      name: input.dto.nome,
      description: input.dto.descricao ?? null,
      amount: input.dto.valor,
      frequencyType: planType,
      isStandalone,
      platformFee: (() => {
        const m1x = getPlatformTaxaEffective(platformTag, 'MDR_CC_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_1X);
        const mMaster = getPlatformTaxaEffective(platformTag, 'MDR_CC_MASTER_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_MASTER_1X);
        return isStandalone ? 0 : Math.round((m1x + mMaster) * 10000) / 100;
      })(),
      redirectUrl: input.dto.redirectUrl ?? null,
      webhookUrl: input.dto.webhookUrl ?? null,
      maxUses: input.dto.maxUses ?? null,
      domPlanId: domPlan.id,
      paymentMethods: input.dto.paymentMethods ?? 'BOTH',
      platformTag: clientTag ?? input.dto.platformTag ?? null,
      emailBody: input.dto.emailBody ?? null,
      // Cliente SimintPay: atribui a plataforma "SIMINTPAY" (exibição/agrupamento) para o
      // master aplicar taxas via CLIENT:<email>. Mesmo padrão do link de pagamento e plano.
      plataformas: clientTag ? ['SIMINTPAY'] : (input.dto.plataformas ?? []),
    });

    // Regra de negócio: link de assinatura NUNCA cria comunidade automaticamente.
    // Apenas vincula quando communityId é informado no cadastro.
    if (input.dto.communityId) {
      await this.communities.bindSubscriptionLinkManually({
        communityId: input.dto.communityId,
        subscriptionLinkId: saved.id,
      });
    }

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
