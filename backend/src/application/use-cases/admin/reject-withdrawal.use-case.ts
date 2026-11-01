import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { WithdrawStatus, Prisma } from '@prisma/client';
import { applyWalletEntry } from '../../../modules/wallet-ledger/wallet-ledger';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { ModuleRealtimeNotifyService } from '../../../infrastructure/realtime/module-realtime-notify.service';

@Injectable()
export class RejectWithdrawalUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ModuleRealtimeNotifyService,
  ) {}

  async execute(
    withdrawId: string,
    reason: string,
    adminUserId?: string,
  ): Promise<{ message: string }> {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
      include: { user: { include: { wallet: true } } },
    });

    if (!withdraw) {
      throw new NotFoundException('Saque não encontrado');
    }

    if (withdraw.status === WithdrawStatus.REJECTED) {
      return { message: 'Saque já rejeitado' };
    }

    if (withdraw.status !== WithdrawStatus.PENDING) {
      throw new BadRequestException(
        `Não é possível rejeitar um saque com status ${withdraw.status}. Somente saques PENDENTES podem ser rejeitados.`,
      );
    }

    const wallet = withdraw.user.wallet;
    if (!wallet) {
      throw new NotFoundException('Wallet não encontrada');
    }

    // Rejeita o saque e desbloqueia o saldo em uma transação atômica
    await this.prisma.$transaction(async (tx) => {
      // 1. Atualizar status da solicitação
      const claimed = await tx.withdrawRequest.updateMany({
        where: { id: withdrawId, status: WithdrawStatus.PENDING },
        data: {
          status: WithdrawStatus.REJECTED,
          rejectionReason: reason,
          reviewedAt: new Date(),
          reviewSource: 'SIMPAY_ADMIN',
          reviewedByReference: adminUserId ?? null,
          updatedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Saque alterado por outro administrador.');
      }

      // 2. Registrar o desbloqueio (a trigger do BalanceLog atualiza lockedBalance) - Pula se for Atlas
      if (withdraw.platform?.toLowerCase() !== 'atlas') {
        await applyWalletEntry(tx, {
          userId: withdraw.userId,
          action: 'WITHDRAW_REJECTED',
          // O saldo total não muda, apenas o bloqueado foi liberado
          balanceDelta: 0,
          lockedDelta: new Prisma.Decimal(withdraw.grossAmount).neg(),
          source: 'WITHDRAW',
          description: `Saque rejeitado: R$ ${withdraw.grossAmount.toFixed(2)}. Motivo: ${reason}`,
        });
      }
    });

    await this.realtime.notifyWithdrawal(withdraw.userId, {
      withdrawId,
      action: 'rejected',
    });

    return { message: 'Saque rejeitado e saldo desbloqueado' };
  }
}
