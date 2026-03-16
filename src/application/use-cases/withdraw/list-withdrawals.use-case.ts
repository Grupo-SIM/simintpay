import { Inject, Injectable } from '@nestjs/common';
import { WithdrawStatus } from '@prisma/client';
import { WITHDRAW_REPOSITORY } from '../../../core/repositories/withdraw.repository.interface';
import type {
  IWithdrawRepository,
  WithdrawWithUser,
} from '../../../core/repositories/withdraw.repository.interface';
import type { ListWithdrawalsQueryDto } from '../../dtos/withdraw/list-withdrawals.query.dto';

function mapPtToInternal(
  status: ListWithdrawalsQueryDto['status'],
): WithdrawStatus | undefined {
  switch (status) {
    case 'PENDENTE':
      return WithdrawStatus.PENDING;
    case 'APROVADO':
      return WithdrawStatus.APPROVED;
    case 'PAGO':
      return WithdrawStatus.COMPLETED;
    case 'REJEITADO':
      return WithdrawStatus.REJECTED;
    default:
      return undefined;
  }
}

function mapInternalToPt(
  status: WithdrawStatus,
): 'PENDENTE' | 'APROVADO' | 'REJEITADO' | 'PAGO' {
  switch (status) {
    case WithdrawStatus.PENDING:
      return 'PENDENTE';
    case WithdrawStatus.APPROVED:
      return 'APROVADO';
    case WithdrawStatus.COMPLETED:
      return 'PAGO';
    case WithdrawStatus.REJECTED:
    default:
      return 'REJEITADO';
  }
}

function toResponse(w: WithdrawWithUser) {
  return {
    id: w.id,
    valor: Number(w.amount),
    valorBruto: Number(w.grossAmount),
    taxa: Number(w.fee),
    status: mapInternalToPt(w.status),
    chavePix: w.pixKey,
    comprovante: w.receiptImage ?? null,
    motivoRejeicao: w.rejectionReason ?? null,
    criadoEm: w.createdAt.toISOString(),
    atualizadoEm: w.updatedAt.toISOString(),
    usuario: {
      nome: w.user.name,
      email: w.user.email,
    },
  };
}

@Injectable()
export class ListWithdrawalsUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY)
    private readonly withdraws: IWithdrawRepository,
  ) {}

  async execute(input: {
    userId: string;
    query: ListWithdrawalsQueryDto;
  }): Promise<{
    data: unknown;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 10;

    const dbStatus =
      input.query.status && input.query.status !== 'all'
        ? mapPtToInternal(input.query.status)
        : undefined;

    const { total, items } = await this.withdraws.findByUserId({
      userId: input.userId,
      page,
      pageSize,
      status: dbStatus,
    });

    return {
      data: items.map(toResponse),
      page,
      pageSize,
      total,
    };
  }
}
