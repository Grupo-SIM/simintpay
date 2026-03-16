import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class DeletePaymentLinkUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string; id: string }): Promise<void> {
    const existing = await this.links.findByIdForUser({
      id: input.id,
      userId: input.userId,
    });
    if (!existing) throw new NotFoundException('Link não encontrado');

    const user = await this.users.findById(input.userId);
    if (!user?.domToken) {
      throw new UnauthorizedException('Usuário não autenticado na api-dom');
    }

    if (existing.domPaymentLinkId) {
      await this.gateway.deletePaymentLink(
        user.domToken,
        existing.domPaymentLinkId,
      );
    }

    await this.links.delete(existing.id);
  }
}
