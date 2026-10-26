import { expect, test } from 'bun:test';
import { Prisma, WithdrawStatus } from '@prisma/client';
import { ListWithdrawalsUseCase } from './list-withdrawals.use-case';
import { ListWithdrawalsAdminUseCase } from '../admin/list-withdrawals-admin.use-case';

for (const [snapshot, status, expected] of [
  [null, WithdrawStatus.APPROVED, null],
  [125.25, WithdrawStatus.APPROVED, 125.25],
  [0, WithdrawStatus.COMPLETED, 0],
  [-10, WithdrawStatus.APPROVED, -10],
  [125.25, WithdrawStatus.REJECTED, null],
  [125.25, WithdrawStatus.PENDING, 125.25],
] as const) {
  test(`lists preserve historical balance ${snapshot} for ${status}`, async () => {
    const row = {
      id: 'withdrawal', amount: 98, grossAmount: 100, fee: 2, status,
      remainingBalanceAfterWithdrawal: snapshot == null ? null : new Prisma.Decimal(snapshot),
      createdAt: new Date(), updatedAt: new Date(),
      user: { id: 'user', name: 'Client', email: 'client@example.com', wallet: { balance: 9999, lockedBalance: 0 }, externalPlatformUsers: [] },
    };
    const user = new ListWithdrawalsUseCase({ findByUserId: async () => ({ total: 1, items: [row] }) } as any);
    const admin = new ListWithdrawalsAdminUseCase({ withdrawRequest: { findMany: async () => [row], count: async () => 1 } } as any);
    const userResult = await user.execute({ userId: 'user', query: {} });
    const adminResult = await admin.execute({ page: 1, pageSize: 10 });
    expect((userResult.data as any[])[0].saldoRestanteAposSaque).toBe(expected);
    expect(adminResult.data[0].saldoRestanteAposSaque).toBe(expected);
  });
}
