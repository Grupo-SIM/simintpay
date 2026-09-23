import { BadRequestException, ForbiddenException, Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { isMasterAdminUser } from '../../../shared/utils/is-master-admin.util';

@Injectable()
export class RemoveInactiveSubscriptionHistoryUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { userId: string; domSubscriptionId: string }): Promise<{ removed: true }> {
    const requester = await this.prisma.user.findUnique({
      where: { id: input.userId },
      include: { tenantModule: true },
    });
    if (!requester || !isMasterAdminUser(requester)) {
      throw new ForbiddenException('Somente o admin master pode excluir assinaturas do histórico');
    }

    const pause = await this.prisma.subscriptionPause.findUnique({
      where: { domSubscriptionId: input.domSubscriptionId },
    });
    if (pause) {
      throw new BadRequestException('Assinaturas pausadas não podem ser excluídas do histórico. Retome ou mantenha a pausa.');
    }

    const domToken = process.env.DOM_TOKEN;
    if (!domToken) {
      throw new InternalServerErrorException('Token DOM não configurado');
    }

    const raw = await this.gateway.getSubscription(domToken, input.domSubscriptionId);
    const subscription = this.asRecord(this.asRecord(raw)?.data) ?? this.asRecord(raw);
    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada na DOM');
    }

    const status = String(subscription.status ?? '').trim().toUpperCase();
    if (status === 'ACTIVE') {
      throw new BadRequestException('Assinaturas ativas não podem ser excluídas do histórico');
    }
    if (!status) {
      throw new BadRequestException('Não foi possível confirmar o status da assinatura na DOM');
    }

    await this.prisma.subscriptionHistoryExclusion.upsert({
      where: { domSubscriptionId: input.domSubscriptionId },
      create: { domSubscriptionId: input.domSubscriptionId, removedByUserId: input.userId },
      update: { removedByUserId: input.userId },
    });

    return { removed: true };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }
}
