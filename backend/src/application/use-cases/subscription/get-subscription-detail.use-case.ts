import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class GetSubscriptionDetailUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: {
    userId: string;
    role?: string;
    id: string;
  }): Promise<unknown> {
    const domToken = await this.resolveDomToken(
      input.userId,
      input.role === 'ADMIN',
    );
    if (!domToken) {
      throw new InternalServerErrorException(
        'Token DOM não configurado para este usuário',
      );
    }
    return this.gateway.getSubscription(domToken, input.id);
  }

  private async resolveDomToken(
    userId: string,
    isAdmin: boolean,
  ): Promise<string | null> {
    if (isAdmin) return process.env.DOM_TOKEN ?? null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { domToken: true },
    });
    if (user?.domToken) return user.domToken;

    return process.env.DOM_TOKEN ?? null;
  }
}
