import { Inject, Injectable } from '@nestjs/common';
import { WITHDRAW_REPOSITORY } from '../../../core/repositories/withdraw.repository.interface';
import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';

@Injectable()
export class CheckPendingWithdrawUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY)
    private readonly withdraws: IWithdrawRepository,
  ) { }

  async execute(userId: string): Promise<{
    temPendente: boolean;
    saquePendente: {
      id: string;
      /** Valor bruto solicitado (ex.: 100) — alinhado a GET /saques e resumo */
      valor: number;
      valorBruto: number;
      /** Valor líquido a receber após taxa (ex.: 98) */
      valorLiquido: number;
      taxa: number;
      criadoEm: string;
    } | null;
  }> {
    const pending = await this.withdraws.findPendingByUserId(userId);

    return {
      temPendente: Boolean(pending),
      saquePendente: pending
        ? {
          id: pending.id,
          valor: Number(pending.grossAmount),
          valorBruto: Number(pending.grossAmount),
          valorLiquido: Number(pending.amount),
          taxa: Number(pending.fee),
          criadoEm: pending.createdAt.toISOString(),
        }
        : null,
    };
  }
}
