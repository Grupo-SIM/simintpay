import { WithdrawRequest, WithdrawStatus } from '@prisma/client';
import type { IWithdrawRepository, WithdrawWithUser } from '../../../core/repositories/withdraw.repository.interface';
import { PrismaService } from '../prisma/prisma.service';
export declare class PrismaWithdrawRepository implements IWithdrawRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findPendingByUserId(userId: string): Promise<WithdrawRequest | null>;
    findByUserId(input: {
        userId: string;
        page: number;
        pageSize: number;
        status?: WithdrawStatus;
    }): Promise<{
        total: number;
        items: WithdrawWithUser[];
    }>;
    createWithWalletLock(input: {
        userId: string;
        amount: number;
        grossAmount: number;
        fee: number;
        pixKey: string;
        domWithdrawId: string;
        amountToLock: number;
        currentWalletVersion: number;
    }): Promise<WithdrawRequest>;
}
