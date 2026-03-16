import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class MonthlyRevenueUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string }): Promise<{ data: unknown }> {
    const user = await this.users.findById(input.userId);
    if (!user?.domToken) {
      throw new UnauthorizedException('Usuário não autenticado na api-dom');
    }

    const out = await this.gateway.getMonthlyRevenue(user.domToken);

    return {
      data: out.items.map((i) => ({
        data: i.date,
        valor: i.value,
      })),
    };
  }
}
