import { BalanceLog } from '@prisma/client';

export const BALANCE_LOG_REPOSITORY = Symbol('BALANCE_LOG_REPOSITORY');

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
