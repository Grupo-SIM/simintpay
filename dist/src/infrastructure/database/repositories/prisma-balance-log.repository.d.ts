import { BalanceLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';
export declare class PrismaBalanceLogRepository implements IBalanceLogRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(data: {
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
    }): Promise<BalanceLog>;
}
