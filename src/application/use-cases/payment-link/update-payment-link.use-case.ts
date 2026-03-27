import { Inject, Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { UpdatePaymentLinkDto } from '../../dtos/payment-link/update-payment-link.dto';

@Injectable()
export class UpdatePaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: {
    userId: string;
    id: string;
    dto: UpdatePaymentLinkDto;
  }): Promise<{ data: unknown }> {
    const existing = await this.links.findByIdForUser({
      id: input.id,
      userId: input.userId,
    });
    if (!existing) throw new NotFoundException('Link não encontrado');

    const domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new InternalServerErrorException('DOM_TOKEN não configurado');

    if (existing.domPaymentLinkId) {
      await this.gateway.updatePaymentLink(domToken, existing.domPaymentLinkId, {
        title: input.dto.titulo,
        description: input.dto.descricao ?? undefined,
        amount: input.dto.valor,
        maxInstallments: input.dto.parcelasMax,
        isActive: input.dto.isActive,
      });
    }

    const updated = await this.links.update(existing.id, {
      title: input.dto.titulo ?? existing.title,
      description: input.dto.descricao ?? existing.description,
      amount: input.dto.valor ?? Number(existing.amount),
      expiresAt: input.dto.dataExpiracao ? new Date(input.dto.dataExpiracao) : (existing as any).expiresAt ?? null,
      maxInstallments: input.dto.parcelasMax ?? existing.maxInstallments,
      isActive: input.dto.isActive ?? existing.isActive,
    });

    return {
      data: {
        id: updated.id,
        codigo: updated.code,
        titulo: updated.title,
        descricao: updated.description ?? null,
        valor: Number(updated.amount),
        dataExpiracao: (updated as any).expiresAt ? (updated as any).expiresAt.toISOString() : null,
        parcelasMax: updated.maxInstallments,
        ativo: updated.isActive,
        criadoEm: updated.createdAt.toISOString(),
      },
    };
  }
}
