jest.mock('../platform-taxas/platform-taxas.store', () => { const values: Record<string, number> = {}; return { getPlatformTaxaEffective: (_tag: string, key: string, fallback: number) => values[key] ?? fallback, patchPlatformOverrides: async (_tag: string, patch: Record<string, number>) => Object.assign(values, patch) }; });
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReturnBetWithdrawalPolicyService } from './return-bet-withdrawal-policy.service';

function makePrisma() {
  return {
    returnBetWithdrawalPolicy: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create, update }: any) => ({
        ...create,
        ...update,
        minimumGrossAmount: new Prisma.Decimal(update.minimumGrossAmount ?? create.minimumGrossAmount),
        fixedWithdrawalFee: new Prisma.Decimal(update.fixedWithdrawalFee ?? create.fixedWithdrawalFee),
      })),
    },
  } as any;
}

describe('ReturnBetWithdrawalPolicyService', () => {
  it('creates and returns the default policy', async () => {
    const prisma = makePrisma();
    const service = new ReturnBetWithdrawalPolicyService(prisma);

    await expect(service.get()).resolves.toEqual({
      minimumGrossAmount: 100,
      fixedWithdrawalFee: 2,
      withdrawalWindowDays: 30,
    });
  });

  it('persists valid custom policy values', async () => {
    const prisma = makePrisma();
    prisma.returnBetWithdrawalPolicy.findUnique.mockResolvedValue({ withdrawalWindowDays: 14 });
    const service = new ReturnBetWithdrawalPolicyService(prisma);

    await expect(
      service.set({ minimumGrossAmount: 80, fixedWithdrawalFee: 5, withdrawalWindowDays: 14 }),
    ).resolves.toEqual({ minimumGrossAmount: 80, fixedWithdrawalFee: 5, withdrawalWindowDays: 14 });
  });

  it.each([
    { minimumGrossAmount: 0, fixedWithdrawalFee: 0, withdrawalWindowDays: 30 },
    { minimumGrossAmount: 100, fixedWithdrawalFee: 100, withdrawalWindowDays: 30 },
    { minimumGrossAmount: 100, fixedWithdrawalFee: 2, withdrawalWindowDays: 0 },
    { minimumGrossAmount: 100, fixedWithdrawalFee: 2, withdrawalWindowDays: 366 },
  ])('rejects invalid policy %#', async (input) => {
    const service = new ReturnBetWithdrawalPolicyService(makePrisma());
    await expect(service.set(input)).rejects.toBeInstanceOf(BadRequestException);
  });
});
