import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';

@Injectable()
export class GetPublicPaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
  ) {}

  async execute(id: string): Promise<{
    id: string;
    titulo: string;
    descricao: string | null;
    valor: number;
    parcelasMax: number;
    ativo: boolean;
  }> {
    const link = await this.links.findById(id);
    if (!link || !link.isActive) {
      throw new NotFoundException('Link de pagamento não encontrado ou inativo');
    }
    return {
      id: link.id,
      titulo: link.title,
      descricao: link.description ?? null,
      valor: Number(link.amount),
      parcelasMax: link.maxInstallments,
      ativo: link.isActive,
    };
  }
}
