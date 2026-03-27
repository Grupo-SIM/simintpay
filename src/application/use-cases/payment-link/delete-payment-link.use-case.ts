import { Inject, Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class DeletePaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string; role?: string; id: string }): Promise<void> {
    const existing = input.role === 'ADMIN'
      ? await this.links.findById(input.id)
      : await this.links.findByIdForUser({ id: input.id, userId: input.userId });
    if (!existing) throw new NotFoundException('Link não encontrado');

    const domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new InternalServerErrorException('DOM_TOKEN não configurado');

    if (existing.domPaymentLinkId) {
      await this.gateway.deletePaymentLink(domToken, existing.domPaymentLinkId);
    }

    await this.links.delete(existing.id);
  }
}
