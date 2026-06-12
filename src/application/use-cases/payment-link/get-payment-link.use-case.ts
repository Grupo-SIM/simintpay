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
    role?: string;
    id: string;
  }): Promise<{ data: unknown }> {
    const link = input.role === 'ADMIN'
      ? await this.links.findById(input.id)
      : await this.links.findByIdForUser({ id: input.id, userId: input.userId });
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
        isStandalone: link.isStandalone,
        aceitaDebito: link.aceitaDebito,
        redirectUrl: (link as any).redirectUrl ?? null,
        webhookUrl: (link as any).webhookUrl ?? null,
        emailBody: (link as any).emailBody ?? null,
        plataformas: (link as any).plataformas ?? [],
        platformFee1x: link.platformFee1x,
        platformFee2x: link.platformFee2x,
        platformFee3x: link.platformFee3x,
        platformFee4x: link.platformFee4x,
        platformFee5x: link.platformFee5x,
        platformFee6x: link.platformFee6x,
        platformFee7x: link.platformFee7x,
        platformFee8x: link.platformFee8x,
        platformFee9x: link.platformFee9x,
        platformFee10x: link.platformFee10x,
        platformFee11x: link.platformFee11x,
        platformFee12x: link.platformFee12x,
        criadoEm: link.createdAt.toISOString(),
      },
    };
  }
}
