import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getModuleDomToken } from '../../../modules/module.registry';

@Injectable()
export class CancelSubscriptionUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { userId: string; role?: string; id: string }): Promise<void> {
    const domToken = await this.resolveDomToken(input.userId, input.role === 'ADMIN');
    if (!domToken) {
      throw new InternalServerErrorException('Token DOM não configurado para este usuário');
    }

    await this.gateway.cancelSubscription(domToken, input.id);
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
