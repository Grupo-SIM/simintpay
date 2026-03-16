import { BalanceLog } from '@prisma/client';
export declare const BALANCE_LOG_REPOSITORY: unique symbol;
export interface IBalanceLogRepository {
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
