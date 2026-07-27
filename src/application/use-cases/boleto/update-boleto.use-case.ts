import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { BOLETO_REPOSITORY } from '../../../core/repositories/boleto.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IBoletoRepository } from '../../../core/repositories/boleto.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { UpdateBoletoDto } from '../../dtos/boleto/update-boleto.dto';

@Injectable()
export class UpdateBoletoUseCase {
  private readonly logger = new Logger(UpdateBoletoUseCase.name);

  constructor(
    @Inject(BOLETO_REPOSITORY)
    private readonly boletos: IBoletoRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: {
    userId: string;
    role?: string;
    id: string;
    dto: UpdateBoletoDto;
  }): Promise<{ data: unknown }> {
    const existing = input.role === 'ADMIN'
      ? await this.boletos.findById(input.id)
      : await this.boletos.findByIdForUser({ id: input.id, userId: input.userId });
    if (!existing) throw new NotFoundException('Boleto não encontrado');

    const domToken = process.env.DOM_TOKEN;

    // Sincroniza com a DOM apenas os campos que o gateway reconhece. Falha no DOM
    // não bloqueia a atualização local (alinhado ao Link de Pagamento).
    if (domToken && existing.domPaymentLinkId) {
      try {
        await this.gateway.updatePaymentLink(domToken, existing.domPaymentLinkId, {
          title: input.dto.titulo,
          description: input.dto.descricao ?? undefined,
          amount: input.dto.valor,
          isActive: input.dto.isActive,
        });
      } catch (err: unknown) {
        this.logger.warn(
          `DOM updatePaymentLink (boleto) falhou para ${existing.domPaymentLinkId}: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    const updated = await this.boletos.update(existing.id, {
      title: input.dto.titulo ?? existing.title,
      description: input.dto.descricao ?? existing.description,
      amount: input.dto.valor ?? Number(existing.amount),
      expiresAt: input.dto.dataExpiracao ? new Date(input.dto.dataExpiracao) : existing.expiresAt ?? null,
      vencimentoDias: input.dto.vencimentoDias ?? existing.vencimentoDias,
      isActive: input.dto.isActive ?? existing.isActive,
      webhookUrl: input.dto.webhookUrl ?? existing.webhookUrl,
      maxUses: input.dto.maxUses ?? existing.maxUses,
      ...(input.dto.plataformas !== undefined && { plataformas: input.dto.plataformas }),
    });

    return {
      data: {
        id: updated.id,
        codigo: updated.code,
        titulo: updated.title,
        descricao: updated.description ?? null,
        valor: Number(updated.amount),
        vencimentoDias: updated.vencimentoDias,
        dataExpiracao: updated.expiresAt ? updated.expiresAt.toISOString() : null,
        ativo: updated.isActive,
        link: updated.domLink ?? null,
        criadoEm: updated.createdAt.toISOString(),
      },
    };
  }
}
