import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BOLETO_REPOSITORY } from '../../../core/repositories/boleto.repository.interface';
import type { IBoletoRepository } from '../../../core/repositories/boleto.repository.interface';

@Injectable()
export class GetBoletoUseCase {
  constructor(
    @Inject(BOLETO_REPOSITORY)
    private readonly boletos: IBoletoRepository,
  ) {}

  async execute(input: {
    userId: string;
    role?: string;
    id: string;
  }): Promise<{ data: unknown }> {
    const boleto = input.role === 'ADMIN'
      ? await this.boletos.findById(input.id)
      : await this.boletos.findByIdForUser({ id: input.id, userId: input.userId });
    if (!boleto) throw new NotFoundException('Boleto não encontrado');

    return {
      data: {
        id: boleto.id,
        codigo: boleto.code,
        titulo: boleto.title,
        descricao: boleto.description ?? null,
        valor: Number(boleto.amount),
        vencimentoDias: boleto.vencimentoDias,
        dataExpiracao: boleto.expiresAt ? boleto.expiresAt.toISOString() : null,
        ativo: boleto.isActive,
        redirectUrl: boleto.redirectUrl ?? null,
        webhookUrl: boleto.webhookUrl ?? null,
        maxUses: boleto.maxUses ?? null,
        link: boleto.domLink ?? null,
        plataformas: boleto.plataformas ?? [],
        criadoEm: boleto.createdAt.toISOString(),
      },
    };
  }
}
