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

    return {
      newExpiresAt: newExpiresAt.toISOString(),
      remainingDays: pause.remainingDays,
    };
  }

  constructor(private readonly prisma: PrismaService) {}
}
