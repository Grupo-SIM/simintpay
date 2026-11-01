import { Injectable } from '@nestjs/common';
import { Prisma, WithdrawRequest, WithdrawStatus } from '@prisma/client';
import type {
  IWithdrawRepository,
  WithdrawWithUser,
} from '../../../core/repositories/withdraw.repository.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyWalletEntry,
  lockWalletLedger,
} from '../../../modules/wallet-ledger/wallet-ledger';

/** Thrown when the wallet no longer covers the requested gross amount once the ledger lock is held. */
export class InsufficientWithdrawBalanceError extends Error {
  constructor(readonly available: Prisma.Decimal) {
    super('Insufficient available balance');
  }
}

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

    const total = await this.prisma.withdrawRequest.count({ where });
    const items = await this.prisma.withdrawRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return { total, items };
  }

  async createWithWalletLock(input: {
    userId: string;
    amount: number;
    grossAmount: number;
    fee: number;
    pixKey: string;
    domWithdrawId?: string | null;
    platform?: string | null;
    amountToLock: number;
  }): Promise<WithdrawRequest> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize with every other ledger writer of this user before reading the balance.
      await lockWalletLedger(tx, input.userId);
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: input.userId },
      });
      const available = new Prisma.Decimal(wallet.balance).minus(
        wallet.lockedBalance,
      );
      if (
        new Prisma.Decimal(input.amountToLock).toDP(2).gt(available.toDP(2))
      ) {
        throw new InsufficientWithdrawBalanceError(available);
      }
      const created = await tx.withdrawRequest.create({
        data: {
          userId: input.userId,
          remainingBalanceAfterWithdrawal: new Prisma.Decimal(wallet.balance)
            .minus(wallet.lockedBalance)
            .minus(input.amountToLock),
          amount: new Prisma.Decimal(input.amount),
          grossAmount: new Prisma.Decimal(input.grossAmount),
          fee: new Prisma.Decimal(input.fee),
          status: WithdrawStatus.PENDING,
          pixKey: input.pixKey,
          domWithdrawId: input.domWithdrawId ?? null,
          platform: input.platform ?? null,
        },
      });

      await applyWalletEntry(tx, {
        userId: input.userId,
        action: 'WITHDRAW_REQUESTED',
        balanceDelta: 0,
        lockedDelta: new Prisma.Decimal(input.amountToLock),
        source: 'WITHDRAW',
        metadata: { withdrawId: created.id, pixKey: input.pixKey },
      });
      return created;
    });
  }

  async sumPendingByUserId(userId: string): Promise<number> {
    const aggregate = await this.prisma.withdrawRequest.aggregate({
      where: { userId, status: WithdrawStatus.PENDING },
      _sum: { grossAmount: true },
    });
    return Number(aggregate._sum.grossAmount ?? 0);
  }
}
