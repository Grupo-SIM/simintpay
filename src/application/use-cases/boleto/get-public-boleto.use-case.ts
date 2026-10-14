import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BOLETO_REPOSITORY } from '../../../core/repositories/boleto.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IBoletoRepository } from '../../../core/repositories/boleto.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { calculateBoletoFees } from './boleto-fees.helper';

@Injectable()
export class GetPublicBoletoUseCase {
  constructor(
    @Inject(BOLETO_REPOSITORY)
    private readonly boletos: IBoletoRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: IUserRepository,
  ) {}

  async execute(id: string): Promise<{
    id: string;
    titulo: string;
    descricao: string | null;
    valor: number;
    aceitaBoleto: boolean;
    aceitaPix: boolean;
    vencimentoDias: number;
    ativo: boolean;
    dataExpiracao: string | null;
    redirectUrl: string | null;
    platformTag: string;
  }> {
    const boleto = await this.boletos.findById(id);
    const isExpired =
      Boolean(boleto?.expiresAt) &&
      new Date(boleto!.expiresAt as Date).getTime() <= Date.now();
    if (!boleto || !boleto.isActive || isExpired) {
      throw new NotFoundException('Boleto não encontrado ou inativo');
    }

    let platformTag: string;
    const plats = boleto.plataformas as string[] | undefined;
    if (plats && plats.length > 0 && plats[0]) {
      platformTag = plats[0].toUpperCase();
    } else {
      const owner = await this.users.findById(boleto.userId);
      platformTag = owner?.platform?.tag?.toUpperCase() ?? 'GLOBAL';
    }

    // Garante que o cálculo de taxa esteja disponível (não altera o retorno público,
    // mas valida a plataforma). O líquido é calculado no charge.
    calculateBoletoFees(Number(boleto.amount), platformTag);

    return {
      id: boleto.id,
      titulo: boleto.title,
      descricao: boleto.description ?? null,
      valor: Number(boleto.amount),
      aceitaBoleto: true,
      aceitaPix: true,
      vencimentoDias: boleto.vencimentoDias,
      ativo: boleto.isActive,
      dataExpiracao: boleto.expiresAt ? boleto.expiresAt.toISOString() : null,
      redirectUrl: boleto.redirectUrl ?? null,
      platformTag,
    };
  }
}
