import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { ListSubscribersQueryDto } from '../../dtos/subscription/list-subscribers.query.dto';

@Injectable()
export class ListSubscribersUseCase {
  constructor(
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
    const domToken = process.env.DOM_TOKEN;
    if (!domToken) {
      throw new InternalServerErrorException('DOM_TOKEN não configurado');
    }

    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;

    const res = await this.gateway.listSubscriptions(domToken, {
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
        nome: s.name ?? null,
        descricao: s.description ?? null,
        valor: s.amount ?? null,
        frequencia: s.frequency ?? null,
        intervalo: s.interval ?? null,
        ciclo: s.cycle ?? null,
        formaPagamento: s.paymentMethod ?? null,
        primeiraCobranca: s.firstBillingDate ?? null,
        proximaCobranca: s.expiresAt ?? null,
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
