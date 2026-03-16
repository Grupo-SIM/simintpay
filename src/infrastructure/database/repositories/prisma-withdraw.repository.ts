import { Injectable } from '@nestjs/common';
import { Prisma, WithdrawRequest, WithdrawStatus } from '@prisma/client';
import type {
  IWithdrawRepository,
  WithdrawWithUser,
} from '../../../core/repositories/withdraw.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaWithdrawRepository implements IWithdrawRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPendingByUserId(userId: string): Promise<WithdrawRequest | null> {
    return this.prisma.withdrawRequest.findFirst({
      where: { userId, status: WithdrawStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
    status?: WithdrawStatus;
  }): Promise<{ total: number; items: WithdrawWithUser[] }> {
    const where: Prisma.WithdrawRequestWhereInput = {
      userId: input.userId,
      status: input.status,
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.withdrawRequest.count({ where }),
      this.prisma.withdrawRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);

    return { total, items };
  }

  async createWithWalletLock(input: {
    userId: string;
    amount: number;
    grossAmount: number;
    fee: number;
    pixKey: string;
    domWithdrawId: string;
    amountToLock: number;
    currentWalletVersion: number;
  }): Promise<WithdrawRequest> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.withdrawRequest.create({
        data: {
          userId: input.userId,
          amount: new Prisma.Decimal(input.amount),
          grossAmount: new Prisma.Decimal(input.grossAmount),
          fee: new Prisma.Decimal(input.fee),
          status: WithdrawStatus.PENDING,
          pixKey: input.pixKey,
          domWithdrawId: input.domWithdrawId,
        },
      });

      const updated = await tx.wallet.updateMany({
        where: { userId: input.userId, version: input.currentWalletVersion },
        data: {
          lockedBalance: { increment: new Prisma.Decimal(input.amountToLock) },
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new Error('Wallet version conflict — retry');
      }

      return created;
    });
  }
}
