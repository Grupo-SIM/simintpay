import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { WithdrawStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { ModuleRealtimeNotifyService } from '../../../infrastructure/realtime/module-realtime-notify.service';

@Injectable()
export class RejectWithdrawalUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ModuleRealtimeNotifyService,
  ) {}

  async execute(withdrawId: string, reason: string): Promise<{ message: string }> {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
      include: { user: { include: { wallet: true } } },
    });

    if (!withdraw) {
      throw new NotFoundException('Saque não encontrado');
    }

    if (withdraw.status !== WithdrawStatus.PENDING && withdraw.status !== WithdrawStatus.APPROVED) {
      throw new BadRequestException(
        `Não é possível rejeitar um saque com status ${withdraw.status}. Somente saques PENDENTES ou APROVADOS podem ser rejeitados.`,
      );
    }

    const wallet = withdraw.user.wallet;
    if (!wallet) {
      throw new NotFoundException('Wallet não encontrada');
    }

    // Rejeita o saque e desbloqueia o saldo em uma transação atômica
    await this.prisma.$transaction(async (tx) => {
      // 1. Atualizar status da solicitação
      await tx.withdrawRequest.update({
        where: { id: withdrawId },
        data: {
          status: WithdrawStatus.REJECTED,
          rejectionReason: reason,
          updatedAt: new Date(),
        },
      });

      // 2. Desbloquear saldo (decrementar de lockedBalance, mantendo balance intacto)
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          lockedBalance: { decrement: withdraw.grossAmount },
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      // 3. Registrar log de desbloqueio
      await tx.balanceLog.create({
        data: {
          userId: withdraw.userId,
          action: 'WITHDRAW_REJECTED',
          amount: new Prisma.Decimal(0), // O saldo total não muda, apenas o bloqueado foi liberado
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance,
          lockedBefore: wallet.lockedBalance,
          lockedAfter: new Prisma.Decimal(Number(wallet.lockedBalance) - Number(withdraw.grossAmount)),
          source: 'WITHDRAW',
          description: `Saque rejeitado: R$ ${withdraw.grossAmount.toFixed(2)}. Motivo: ${reason}`,
        },
      });
    });

    await this.realtime.notifyWithdrawal(withdraw.userId, { withdrawId, action: 'rejected' });

    return { message: 'Saque rejeitado e saldo desbloqueado' };
  }
}
