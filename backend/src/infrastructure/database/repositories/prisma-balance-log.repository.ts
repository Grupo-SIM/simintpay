import { Injectable } from '@nestjs/common';
import { BalanceLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';

@Injectable()
export class PrismaBalanceLogRepository implements IBalanceLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    action: string;
    transactionId?: string | null;
    amount: string;
    balanceBefore: string;
    balanceAfter: string;
    lockedBefore: string;
    lockedAfter: string;
    description?: string | null;
    source: string;
    metadata?: unknown;
  }): Promise<BalanceLog> {
    return this.prisma.balanceLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        transactionId: data.transactionId ?? undefined,
        amount: data.amount,
        balanceBefore: data.balanceBefore,
        balanceAfter: data.balanceAfter,
        lockedBefore: data.lockedBefore,
        lockedAfter: data.lockedAfter,
        description: data.description ?? undefined,
        source: data.source,
        metadata: data.metadata as never,
      },
    });
  }
}
