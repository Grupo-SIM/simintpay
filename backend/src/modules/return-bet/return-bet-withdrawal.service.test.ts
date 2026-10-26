import { expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { ReturnBetWithdrawalService } from './return-bet-withdrawal.service';
const input = { requestId: 'r', externalUserId: 'e', name: 'Client', email: 'client@example.com', document: '11122233344', availableBalance: 150, amount: 120, pixKey: 'client@example.com' };
function fixture() {
  const p: any = {
    platform: { findFirst: async () => ({ id: 'p' }), count: async () => 0 },
    user: { findUnique: async () => ({ isActive: true, platform: null }) },
    returnBetAccount: { findUnique: async () => ({ id: 'a', userId: 'owner' }), update: async () => ({ userId: 'owner' }) },
    withdrawRequest: { findUnique: async () => null, findFirst: async () => null, create: mock(async () => ({})) },
    wallet: { findUnique: async () => ({ id: 'w', balance: new Prisma.Decimal(900), lockedBalance: new Prisma.Decimal(0) }), update: mock(async () => ({})) },
    $queryRaw: async () => [], $transaction: async (f: any) => f(p),
  };
  const policy: any = { get: async () => ({ minimumGrossAmount: 100, fixedWithdrawalFee: 2, withdrawalWindowDays: 30 }) };
  return { p, service: new ReturnBetWithdrawalService(p, policy) };
}
test('Return Bet snapshot cannot overwrite wallet owned by another product', async () => {
  const { p, service } = fixture(); p.platform.count = async () => 2;
  await expect(service.request(input)).rejects.toThrow('carteira compartilhada');
  expect(p.wallet.update).not.toHaveBeenCalled(); expect(p.withdrawRequest.create).not.toHaveBeenCalled();
});
test('Return Bet snapshot cannot overwrite foreign platform member wallet', async () => {
  const { p, service } = fixture(); p.user.findUnique = async () => ({ isActive: true, platform: { tag: 'BOSQUE' } });
  await expect(service.request(input)).rejects.toThrow('carteira compartilhada');
  expect(p.wallet.update).not.toHaveBeenCalled();
});
test('idempotency key belonging to another platform or customer cannot leak its withdrawal', async () => {
  for (const override of [{ platform: 'bosque' }, { userId: 'other' }, { grossAmount: new Prisma.Decimal(130) }]) {
    const { p, service } = fixture();
    p.withdrawRequest.findUnique = async () => ({ userId: 'owner', platform: 'return-bet', grossAmount: new Prisma.Decimal(120), pixKey: input.pixKey, ...override });
    await expect(service.request(input)).rejects.toThrow('outro contrato');
    expect(p.wallet.update).not.toHaveBeenCalled();
  }
});
test('Return Bet reserves gross amount from explicit source snapshot', async () => {
  const { p, service } = fixture();
  p.withdrawRequest.create.mockImplementation(async ({ data }: any) => ({ id: 'w', ...data }));
  await service.request(input);
  expect(Number(p.withdrawRequest.create.mock.calls[0][0].data.remainingBalanceAfterWithdrawal)).toBe(30);
});
test('Return Bet approval freezes post-debit available balance', async () => {
  const { p, service } = fixture();
  const withdrawal = { id: 'w', userId: 'owner', integrationRequestId: 'r', platform: 'return-bet', status: 'PENDING', grossAmount: new Prisma.Decimal(120), amount: new Prisma.Decimal(118), fee: new Prisma.Decimal(2), pixKey: input.pixKey };
  p.withdrawRequest.findFirstOrThrow = async () => withdrawal;
  p.wallet.findUniqueOrThrow = p.wallet.findUnique;
  p.withdrawRequest.updateMany = async () => ({ count: 1 });
  p.withdrawRequest.update = mock(async () => ({}));
  p.wallet.update.mockImplementation(async () => ({ balance: new Prisma.Decimal(350), lockedBalance: new Prisma.Decimal(20) }));
  p.balanceLog = { create: async () => ({}) };
  await service.approve('r', 'receipt', {});
  expect(Number(p.withdrawRequest.update.mock.calls[0][0].data.remainingBalanceAfterWithdrawal)).toBe(330);
});
