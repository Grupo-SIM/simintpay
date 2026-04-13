import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getModuleDomToken } from '../../../modules/module.registry';

@Injectable()
export class PauseSubscriptionUseCase {
  private readonly logger = new Logger(PauseSubscriptionUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: {
    userId: string;
    role?: string;
    /** ID da assinatura na DOM (domSubscriptionId) */
    domSubscriptionId: string;
  }): Promise<{
    remainingDays: number;
    pausedAt: string;
    warningMessage: string;
  }> {
    // 1. Verificar se já está pausada
    const existing = await this.prisma.subscriptionPause.findUnique({
      where: { domSubscriptionId: input.domSubscriptionId },
    });
    if (existing) {
      throw new BadRequestException(
        `Esta assinatura já está pausada com ${existing.remainingDays} dias restantes.`,
      );
    }

    // 2. Buscar dados frescos da DOM para obter expiresAt confiável
    const domToken = await this.resolveDomToken(input.userId, input.role === 'ADMIN');
    if (!domToken) {
      throw new InternalServerErrorException('Token DOM não configurado para este usuário');
    }

    const rawSub = await this.gateway.getSubscription(domToken, input.domSubscriptionId) as Record<string, unknown>;
    if (!rawSub) {
      throw new NotFoundException('Assinatura não encontrada na DOM');
    }

    // A DOM pode retornar a data de expiração em vários campos dependendo do endpoint
    const subData = (rawSub?.['data'] ?? rawSub) as Record<string, unknown>;
    const autoRecurring = (subData['auto_recurring'] ?? undefined) as Record<string, unknown> | undefined;

    // next_date_invoice fica dentro de auto_recurring na API de detalhe da DOM
    const expiresRaw =
      this.extractString(autoRecurring, 'next_date_invoice') ??
      this.extractString(autoRecurring, 'end_date_invoice') ??
      this.extractString(autoRecurring, 'expires_at') ??
      this.extractString(subData, 'next_date_invoice') ??
      this.extractString(subData, 'expires_at') ??
      this.extractString(subData, 'end_date_invoice') ??
      this.extractString(subData, 'expiresAt');

    if (!expiresRaw) {
      throw new BadRequestException(
        'Não foi possível calcular os dias restantes — data de expiração não disponível na DOM. ' +
        'Verifique se a assinatura está ativa.',
      );
    }

    const expiresAt = new Date(expiresRaw);
    if (isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Data de expiração inválida retornada pela DOM.');
    }

    const now = new Date();
    const remainingMs = expiresAt.getTime() - now.getTime();
    const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));

    if (remainingDays <= 0) {
      throw new BadRequestException(
        'Esta assinatura já está expirada — não é possível pausá-la.',
      );
    }

    // 3. Extrair snapshot para exibição na lista (a assinatura some da DOM após cancelamento)
    const subscriberName = this.extractString(subData, 'customer_name') ?? null;
    const description    = this.extractString(subData, 'description') ?? null;
    const planId         = this.extractString(subData, 'plan_id') ?? null;
    const frequency      = this.extractString(subData, 'frequency_type') ?? null;
    const firstCharge    = this.extractString(subData, 'start_date_invoice') ?? null;
    const valueBrl       = this.extractNumber(subData, 'value');

    // 4. Cancelar a assinatura na DOM (para a cobrança automática)
    this.logger.log(`[PauseSubscription] Cancelando na DOM: ${input.domSubscriptionId}`);
    await this.gateway.cancelSubscription(domToken, input.domSubscriptionId);

    // 5. Gravar o estado de pausa na api-machine
    await this.prisma.subscriptionPause.create({
      data: {
        domSubscriptionId: input.domSubscriptionId,
        userId: input.userId,
        subscriberName,
        description,
        planId,
        valueBrl,
        frequency,
        interval: 1,
        firstCharge,
        remainingDays,
        pausedAt: now,
      },
    });

    this.logger.log(
      `[PauseSubscription] Pausada: ${input.domSubscriptionId} — ${remainingDays} dias restantes`,
    );

    const warningMessage =
      `⚠️ A assinatura na DOM foi CANCELADA permanentemente. ` +
      `O usuário tem ${remainingDays} dias restantes. ` +
      `Ao retomar, o acesso será liberado por ${remainingDays} dias a partir da reativação. ` +
      `Após isso, o usuário precisará fazer uma NOVA assinatura — a renovação automática não voltará. ` +
      `Informe o usuário sobre isso.`;

    return {
      remainingDays,
      pausedAt: now.toISOString(),
      warningMessage,
    };
  }

  private extractString(obj: Record<string, unknown> | undefined, key: string): string | null {
    if (!obj) return null;
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
    return null;
  }

  private extractNumber(obj: Record<string, unknown> | undefined, key: string): number | null {
    if (!obj) return null;
    const v = obj[key];
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  private async resolveDomToken(userId: string, isAdmin: boolean): Promise<string | null> {
    if (isAdmin) return process.env.DOM_TOKEN ?? null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { domToken: true, tenantModule: { select: { slug: true } } },
    });
    if (user?.domToken) return user.domToken;

    const moduleToken = getModuleDomToken(user?.tenantModule?.slug);
    if (moduleToken) return moduleToken;

    return process.env.DOM_TOKEN ?? null;
  }
}
