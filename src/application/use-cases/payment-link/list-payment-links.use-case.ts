import { Inject, Injectable } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { ListPaymentLinksQueryDto } from '../../dtos/payment-link/list-payment-links.query.dto';

@Injectable()
export class ListPaymentLinksUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
  ) {}

  async execute(input: {
    userId: string;
    role: string;
    query: ListPaymentLinksQueryDto;
  }): Promise<{
    data: unknown;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;

    const { total, items } =
      input.role === 'ADMIN'
        ? await this.links.findAll({ page, pageSize })
        : await this.links.findManyByUserId({ userId: input.userId, page, pageSize });

    return {
      data: items.map((l) => ({
        id: l.id,
        codigo: l.code,
        titulo: l.title,
        descricao: l.description ?? null,
        valor: Number(l.amount),
        parcelasMax: l.maxInstallments,
        ativo: l.isActive,
        criadoEm: l.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }
}
