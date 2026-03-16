import { Inject, Injectable } from '@nestjs/common';
import { WITHDRAW_REPOSITORY } from '../../../core/repositories/withdraw.repository.interface';
import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';

@Injectable()
export class CheckPendingWithdrawUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY)
    private readonly withdraws: IWithdrawRepository,
  ) {}

  async execute(userId: string): Promise<{
    temPendente: boolean;
    saquePendente: {
      id: string;
      valor: number;
      valorBruto: number;
      criadoEm: string;
    } | null;
  }> {
    const pending = await this.withdraws.findPendingByUserId(userId);

    return {
      temPendente: Boolean(pending),
      saquePendente: pending
        ? {
            id: pending.id,
            valor: Number(pending.amount),
            valorBruto: Number(pending.grossAmount),
            criadoEm: pending.createdAt.toISOString(),
          }
        : null,
    };
  }
}
