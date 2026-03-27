import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class GetSubscriptionDetailUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string; id: string }): Promise<unknown> {
    void input.userId;
    const domToken = process.env.DOM_TOKEN;
    if (!domToken) {
      throw new InternalServerErrorException('DOM_TOKEN não configurado');
    }
    return this.gateway.getSubscription(domToken, input.id);
  }
}
