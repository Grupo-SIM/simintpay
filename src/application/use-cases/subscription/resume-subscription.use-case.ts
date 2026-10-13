import { getPlatformIntegrationValue } from '../../../modules/platform-integrations/platform-integrations.store';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class ResumeSubscriptionUseCase {
  private readonly logger = new Logger(ResumeSubscriptionUseCase.name);

  async execute(input: {
    userId: string;
    role?: string;
    /** ID da assinatura na DOM (domSubscriptionId) */
    domSubscriptionId: string;
  }): Promise<{
    newExpiresAt: string;
    remainingDays: number;
  }> {
    // 1. Buscar registro de pausa
    const pause = await this.prisma.subscriptionPause.findUnique({
      where: { domSubscriptionId: input.domSubscriptionId },
    });

    if (!pause) {
      throw new NotFoundException('Nenhuma pausa encontrada para esta assinatura.');
    }

    if (pause.remainingDays <= 0) {
      throw new BadRequestException('Os dias restantes desta pausa já foram consumidos.');
    }

    // 2. Calcular nova data de expiração: hoje + dias restantes
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + pause.remainingDays * 24 * 60 * 60 * 1000);

    // 3. Se existir registro local de Subscription, atualizar para refletir o retorno
    //    (não cria nova assinatura na DOM — o usuário usa os dias já pagos)
    const localSub = await this.prisma.subscription.findFirst({
      where: { domSubscriptionId: input.domSubscriptionId },
    });

    if (localSub) {
      await this.prisma.subscription.update({
        where: { id: localSub.id },
        data: {
          status: 'active',
          expiresAt: newExpiresAt,
        },
      });
      this.logger.log(
        `[ResumeSubscription] Subscription local ${localSub.id} reativada — expira em ${newExpiresAt.toISOString()}`,
      );
    }

    // 4. Remover o registro de pausa
    await this.prisma.subscriptionPause.delete({
      where: { domSubscriptionId: input.domSubscriptionId },
    });

    this.logger.log(
      `[ResumeSubscription] Pausa removida para ${input.domSubscriptionId} — ${pause.remainingDays} dias liberados até ${newExpiresAt.toISOString()}`,
    );

    const response = {
      newExpiresAt: newExpiresAt.toISOString(),
      remainingDays: pause.remainingDays,
    };

    // Notificar api-pagatg da retomada (para re-adicionar ao Telegram)
    try {
      const apiPagatgUrl = ((getPlatformIntegrationValue('PAGATG', 'BACKEND_URL') ?? undefined) || '').replace(/\/+$/, '');
      const pagatgInternalToken = (getPlatformIntegrationValue('PAGATG', 'INTERNAL_TOKEN') ?? undefined) || '';

      await fetch(`${apiPagatgUrl}/webhook/signature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(pagatgInternalToken ? { 'x-pagatg-internal-token': pagatgInternalToken } : {}),
        },
        body: JSON.stringify({
          type: 'SIGNATURE-RESUMED',
          data: {
            customer: {
              id: pause.subscriberName || 'RESUME',
              name: pause.subscriberName,
              email: pause.customerEmail,
            },
            plan: {
              id: pause.planId,
              description: pause.description,
            },
            subscription: {
              id: input.domSubscriptionId,
              status: 'ACTIVE',
            },
          },
        }),
      });
    } catch (webhookError: any) {
      this.logger.error(`Erro ao notificar api-pagatg de retomada CC: ${webhookError.message}`);
    }

    return response;
  }

  constructor(private readonly prisma: PrismaService) {}
}
