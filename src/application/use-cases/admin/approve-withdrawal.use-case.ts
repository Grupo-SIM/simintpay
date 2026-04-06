import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { WithdrawStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { ModuleRealtimeNotifyService } from '../../../infrastructure/realtime/module-realtime-notify.service';
import { isMasterAdminUser } from '../../../shared/utils/is-master-admin.util';

@Injectable()
export class ApproveWithdrawalUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ModuleRealtimeNotifyService,
  ) {}

  async execute(withdrawId: string, receiptImage?: string, adminUserId?: string): Promise<{ message: string }> {
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

    // Identifica se o admin é do módulo master
    let isMasterAdmin = false;
    if (adminUserId) {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminUserId },
        include: { tenantModule: true },
      });
      if (admin && isMasterAdminUser(admin)) {
        isMasterAdmin = true;
      }
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

      // 4. Sempre incrementa taxa e lucro no log administrativo (independente de quem aprova)
      const logUserId = adminUserId ?? withdraw.userId;
      // Incremento da Taxa de Saque (1 real)
      await tx.balanceLog.create({
        data: {
          userId: logUserId,
          action: 'ADMIN_WITHDRAW_FEE_INC',
          amount: new Prisma.Decimal(1),
          balanceBefore: 0,
          balanceAfter: 0,
          lockedBefore: 0,
          lockedAfter: 0,
          source: 'MASTER_ADMIN_CONTROL',
          description: `Taxa de saque${isMasterAdmin ? ' (Master)' : ''}`,
          metadata: { withdrawId },
        },
      });

      // Incremento do Lucro de Saque (2 reais)
      await tx.balanceLog.create({
        data: {
          userId: logUserId,
          action: 'ADMIN_WITHDRAW_PROFIT_INC',
          amount: new Prisma.Decimal(2),
          balanceBefore: 0,
          balanceAfter: 0,
          lockedBefore: 0,
          lockedAfter: 0,
          source: 'MASTER_ADMIN_CONTROL',
          description: `Lucro de saque${isMasterAdmin ? ' (Master)' : ''}`,
          metadata: { withdrawId },
        },
      });
    });

    await this.realtime.notifyWithdrawal(withdraw.userId, { withdrawId, action: 'approved' });

    return { message: 'Saque aprovado com sucesso e saldo debitado' };
  }
}
