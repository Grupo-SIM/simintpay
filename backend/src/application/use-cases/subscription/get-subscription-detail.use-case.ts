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
    const domToken = process.env.DOM_TOKEN ?? null;
    if (!domToken) {
      throw new InternalServerErrorException(
        'Token DOM não configurado para este usuário',
      );
    }
    return this.gateway.getSubscription(domToken, input.id);
  }
}
