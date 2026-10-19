import { describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';

mock.module('../../../modules/platform-taxas/platform-taxas.store', () => ({
  getPlatformTaxaEffective: () => 2,
}));
const { ApproveWithdrawalUseCase } = await import('./approve-withdrawal.use-case');

describe('withdrawal approval historical balance', () => {
  for (const remaining of [125, 0, -10]) {
    test(`freezes post-debit available balance ${remaining} instead of stale wallet`, async () => {
      const snapshots: unknown[] = [];
      const tx = {
        withdrawRequest: {
          updateMany: async () => ({ count: 1 }),
          update: async (args: unknown) => { snapshots.push(args); },
        },
        wallet: {
          update: async () => ({
            balance: new Prisma.Decimal(remaining + 20),
            lockedBalance: new Prisma.Decimal(20),
          }),
        },
        user: { findUnique: async () => ({ externalPlatformUsers: [], platform: null }) },
        balanceLog: { create: async () => ({}) },
      };
      const prisma = {
        withdrawRequest: { findUnique: async () => ({
          id: 'withdrawal', userId: 'user', status: 'PENDING', platform: 'renovada',
          grossAmount: new Prisma.Decimal(100),
          user: { wallet: {
            id: 'wallet', balance: new Prisma.Decimal(100), lockedBalance: new Prisma.Decimal(100),
          } },
        }) },
        $transaction: async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx),
      };
      const realtime = { notifyWithdrawal: async () => {} };
      const useCase = new ApproveWithdrawalUseCase(prisma as never, realtime as never);
      await useCase.execute('withdrawal');
      expect(snapshots).toEqual([{
        where: { id: 'withdrawal' },
        data: { remainingBalanceAfterWithdrawal: new Prisma.Decimal(remaining) },
      }]);
    });
  }
});
