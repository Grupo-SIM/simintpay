import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { UpdatePaymentLinkDto } from '../../dtos/payment-link/update-payment-link.dto';

@Injectable()
export class UpdatePaymentLinkUseCase {
  private readonly logger = new Logger(UpdatePaymentLinkUseCase.name);

  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: {
    userId: string;
    role?: string;
    id: string;
    dto: UpdatePaymentLinkDto;
  }): Promise<{ data: unknown }> {
    const existing = input.role === 'ADMIN'
      ? await this.links.findById(input.id)
      : await this.links.findByIdForUser({ id: input.id, userId: input.userId });
    if (!existing) throw new NotFoundException('Link não encontrado');

    const domToken = process.env.DOM_TOKEN;

    // Sincronizar com DOM apenas os campos que o gateway reconhece.
    // isStandalone e platformFeeNx são locais — o DOM não os conhece.
    // Se o DOM rejeitar (valor mínimo, link inexistente, etc.) a atualização
    // local continua normalmente para não bloquear campos como isStandalone.
    if (domToken && existing.domPaymentLinkId) {
      try {
        await this.gateway.updatePaymentLink(domToken, existing.domPaymentLinkId, {
          title: input.dto.titulo,
          description: input.dto.descricao ?? undefined,
          amount: input.dto.valor,
          maxInstallments: input.dto.parcelasMax,
          isActive: input.dto.isActive,
        });
      } catch (err: unknown) {
        // Falha no DOM não bloqueia a atualização local
        this.logger.warn(
          `DOM updatePaymentLink falhou para ${existing.domPaymentLinkId}: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    const updated = await this.links.update(existing.id, {
      title: input.dto.titulo ?? existing.title,
      description: input.dto.descricao ?? existing.description,
      amount: input.dto.valor ?? Number(existing.amount),
      expiresAt: input.dto.dataExpiracao ? new Date(input.dto.dataExpiracao) : (existing as any).expiresAt ?? null,
      maxInstallments: input.dto.parcelasMax ?? existing.maxInstallments,
      isActive: input.dto.isActive ?? existing.isActive,
      isStandalone: input.dto.isStandalone ?? (existing as any).isStandalone,
      platformFee1x: input.dto.platformFee1x ?? (existing as any).platformFee1x,
      platformFee2x: input.dto.platformFee2x ?? (existing as any).platformFee2x,
      platformFee3x: input.dto.platformFee3x ?? (existing as any).platformFee3x,
      platformFee4x: input.dto.platformFee4x ?? (existing as any).platformFee4x,
      platformFee5x: input.dto.platformFee5x ?? (existing as any).platformFee5x,
      platformFee6x: input.dto.platformFee6x ?? (existing as any).platformFee6x,
      platformFee7x: input.dto.platformFee7x ?? (existing as any).platformFee7x,
      platformFee8x: input.dto.platformFee8x ?? (existing as any).platformFee8x,
      platformFee9x: input.dto.platformFee9x ?? (existing as any).platformFee9x,
      platformFee10x: input.dto.platformFee10x ?? (existing as any).platformFee10x,
      platformFee11x: input.dto.platformFee11x ?? (existing as any).platformFee11x,
      platformFee12x: input.dto.platformFee12x ?? (existing as any).platformFee12x,
      cashbackFee: input.dto.cashbackFee ?? (existing as any).cashbackFee,
      webhookUrl: input.dto.webhookUrl ?? (existing as any).webhookUrl,
      maxUses: input.dto.maxUses ?? (existing as any).maxUses,
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
        isStandalone: (updated as any).isStandalone,
        criadoEm: updated.createdAt.toISOString(),
      },
    };
  }
}
