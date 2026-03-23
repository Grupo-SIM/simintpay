import type { WithdrawRequest, WithdrawStatus, User } from '@prisma/client';

export const WITHDRAW_REPOSITORY = Symbol('WITHDRAW_REPOSITORY');

export type WithdrawWithUser = WithdrawRequest & {
  user: Pick<User, 'id' | 'name' | 'email'>;
};

export interface IWithdrawRepository {
  findPendingByUserId(userId: string): Promise<WithdrawRequest | null>;
  findByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
    status?: WithdrawStatus;
  }): Promise<{ total: number; items: WithdrawWithUser[] }>;

  createWithWalletLock(input: {
    userId: string;
    amount: number;
    grossAmount: number;
    fee: number;
    pixKey: string;
    domWithdrawId?: string;
    amountToLock: number;
    currentWalletVersion: number;
  }): Promise<WithdrawRequest>;
  sumPendingByUserId(userId: string): Promise<number>;
}
