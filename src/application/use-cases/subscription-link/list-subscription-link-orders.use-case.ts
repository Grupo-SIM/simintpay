import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';

@Injectable()
export class ListSubscriptionLinkOrdersUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
  ) {}

  async execute(input: { userId: string; role?: string; linkId: string; page?: number; pageSize?: number }) {
    const link = input.role === 'ADMIN'
      ? await this.repo.findById(input.linkId)
      : await this.repo.findByIdForUser({ id: input.linkId, userId: input.userId });
    if (!link) throw new NotFoundException('Link de assinatura não encontrado');

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const result = await this.repo.findOrdersByLinkId({ linkId: link.id, page, pageSize });

    return {
      data: result.items.map((o) => ({
        id: o.id,
        customerName: o.customerName,
        customerEmail: o.customerEmail,
        customerDocument: o.customerDocument,
        paymentMethod: o.paymentMethod,
        status: o.status,
        valorCobrado: Number(o.amountCharged),
        criadoEm: o.createdAt.toISOString(),
      })),
      total: result.total,
      page,
      pageSize,
    };
  }
}
