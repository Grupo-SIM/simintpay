import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { WithdrawStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { ModuleRealtimeNotifyService } from '../../../infrastructure/realtime/module-realtime-notify.service';

@Injectable()
export class ApproveWithdrawalUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ModuleRealtimeNotifyService,
  ) {}

  async execute(withdrawId: string, receiptImage?: string): Promise<{ message: string }> {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
      include: { user: { include: { wallet: true } } },
    });

    if (!withdraw) {
      throw new NotFoundException('Saque não encontrado');
    }

    if (withdraw.status !== WithdrawStatus.PENDING) {
      throw new BadRequestException(
        `Não é possível aprovar um saque com status ${withdraw.status}`,
      );
    }

    const wallet = withdraw.user.wallet;
    if (!wallet) {
      throw new NotFoundException('Carteira (Wallet) não encontrada para este usuário');
    }

    // Executa tudo dentro de uma transação do Prisma
    await this.prisma.$transaction(async (tx) => {
      // 1. Atualiza o status da solicitação
      await tx.withdrawRequest.update({
        where: { id: withdrawId },
        data: {
          status: WithdrawStatus.APPROVED,
          receiptImage: receiptImage ?? undefined,
          updatedAt: new Date(),
        },
      });

      // 2. Deduz os valores da wallet (Total e Bloqueado)
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: withdraw.grossAmount },
          lockedBalance: { decrement: withdraw.grossAmount },
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      // 3. Registra log financeiro da operação
      await tx.balanceLog.create({
        data: {
          userId: withdraw.userId,
          action: 'WITHDRAW_APPROVED',
          amount: new Prisma.Decimal(-withdraw.grossAmount),
          balanceBefore: wallet.balance,
          balanceAfter: new Prisma.Decimal(Number(wallet.balance) - Number(withdraw.grossAmount)),
          lockedBefore: wallet.lockedBalance,
          lockedAfter: new Prisma.Decimal(Number(wallet.lockedBalance) - Number(withdraw.grossAmount)),
          source: 'WITHDRAW',
          description: `Saque aprovado: R$ ${withdraw.grossAmount.toFixed(2)}`,
        },
      });
    });

    await this.realtime.notifyWithdrawal(withdraw.userId, { withdrawId, action: 'approved' });

    return { message: 'Saque aprovado com sucesso e saldo debitado' };
  }
}
