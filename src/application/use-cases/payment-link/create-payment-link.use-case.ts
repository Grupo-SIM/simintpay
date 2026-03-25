import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { CreatePaymentLinkDto } from '../../dtos/payment-link/create-payment-link.dto';

@Injectable()
export class CreatePaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string; dto: CreatePaymentLinkDto }): Promise<{
    data: {
      id: string;
      codigo: string;
      titulo: string;
      descricao: string | null;
      valor: number;
      parcelasMax: number;
      ativo: boolean;
      criadoEm: string;
    };
  }> {
    const domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new InternalServerErrorException('DOM_TOKEN não configurado');

    const created = await this.gateway.createPaymentLink(domToken, {
      title: input.dto.titulo,
      description: input.dto.descricao ?? null,
      amount: input.dto.valor,
      maxInstallments: input.dto.parcelasMax ?? 1,
    });

    const saved = await this.links.create({
      userId: input.userId,
      title: input.dto.titulo,
      description: input.dto.descricao ?? null,
      amount: input.dto.valor,
      maxInstallments: input.dto.parcelasMax ?? 1,
      isActive: true,
      domPaymentLinkId: created.id,
    });

    return {
      data: {
        id: saved.id,
        codigo: saved.code,
        titulo: saved.title,
        descricao: saved.description ?? null,
        valor: Number(saved.amount),
        parcelasMax: saved.maxInstallments,
        ativo: saved.isActive,
        criadoEm: saved.createdAt.toISOString(),
      },
    };
  }
}
