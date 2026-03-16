import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { ListSubscribersQueryDto } from '../../dtos/subscription/list-subscribers.query.dto';

@Injectable()
export class ListSubscribersUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: {
    userId: string;
    query: ListSubscribersQueryDto;
  }): Promise<{
    data: unknown;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const user = await this.users.findById(input.userId);
    if (!user?.domToken) {
      throw new UnauthorizedException('Usuário não autenticado na api-dom');
    }

    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;

    const res = await this.gateway.listSubscriptions(user.domToken, {
      page,
      pageSize,
    });

    const filtered = res.items.filter((s) => {
      if (input.query.status && s.status !== input.query.status) return false;
      if (input.query.planoId && s.planId !== input.query.planoId) return false;
      return true;
    });

    return {
      data: filtered.map((s) => ({
        id: s.id,
        status: s.status ?? null,
        expiresAt: s.expiresAt ?? null,
        planoId: s.planId ?? null,
        cliente: s.customer
          ? {
              nome: s.customer.name ?? null,
              email: s.customer.email ?? null,
              documento: s.customer.document ?? null,
              telefone: s.customer.phone ?? null,
            }
          : null,
        criadoEm: s.createdAt ?? null,
      })),
      page,
      pageSize,
      total: filtered.length,
    };
  }
}
