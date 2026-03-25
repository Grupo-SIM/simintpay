import { Inject, Injectable } from '@nestjs/common';
import { WithdrawStatus } from '@prisma/client';
import {
  WITHDRAW_REPOSITORY,
  type IWithdrawRepository,
  type WithdrawWithUser,
} from '../../../core/repositories/withdraw.repository.interface';
import type { ListWithdrawalsQueryDto } from '../../dtos/withdraw/list-withdrawals.query.dto';

function mapPtStatusToDb(
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

function mapWithdrawStatusToPt(
  status: WithdrawStatus,
): 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'PAGO' {
  switch (status) {
    case WithdrawStatus.PENDING:
      return 'PENDENTE';
    case WithdrawStatus.APPROVED:
      return 'APROVADA';
    case WithdrawStatus.COMPLETED:
      return 'PAGO';
    case WithdrawStatus.REJECTED:
      return 'RECUSADA';
    default:
      return 'PENDENTE';
  }
}

function mapWithdrawToResponse(w: WithdrawWithUser) {
  return {
    id: w.id,
    valor: Number(w.grossAmount),
    valorLiquido: Number(w.amount),
    status: mapWithdrawStatusToPt(w.status),
    metodo: 'PIX',
    descricao: 'Saque SimPay',
    chavePix: w.pixKey,
    comprovante: w.receiptImage ?? null,
    observacao: w.rejectionReason ?? null,
    taxas: {
      total: Number(w.fee),
    },
    criadoEm: w.createdAt.toISOString(),
    usuario: {
      id: w.user.id,
      nome: w.user.name,
      email: w.user.email,
    },
  };
}

@Injectable()
export class ListWithdrawalsUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY) private readonly withdrawRepo: IWithdrawRepository,
  ) {}

  async execute(input: {
    userId: string;
    query: ListWithdrawalsQueryDto;
  }): Promise<{ data: unknown; page: number; pageSize: number; total: number }> {
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 10;

    const dbStatus =
      input.query.status && input.query.status !== 'all'
        ? mapPtStatusToDb(input.query.status)
        : undefined;

    const res = await this.withdrawRepo.findByUserId({
      userId: input.userId,
      page,
      pageSize,
      status: dbStatus,
    });

    return {
      data: res.items.map(mapWithdrawToResponse),
      page,
      pageSize,
      total: res.total,
    };
  }
}
