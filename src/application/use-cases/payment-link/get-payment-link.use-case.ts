import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';

@Injectable()
export class GetPaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
  ) {}

  async execute(input: {
    userId: string;
    id: string;
  }): Promise<{ data: unknown }> {
    const link = await this.links.findByIdForUser({
      id: input.id,
      userId: input.userId,
    });
    if (!link) throw new NotFoundException('Link não encontrado');

    return {
      data: {
        id: link.id,
        codigo: link.code,
        titulo: link.title,
        descricao: link.description ?? null,
        valor: Number(link.amount),
        dataExpiracao: (link as any).expiresAt ? (link as any).expiresAt.toISOString() : null,
        parcelasMax: link.maxInstallments,
        ativo: link.isActive,
        criadoEm: link.createdAt.toISOString(),
      },
    };
  }
}
