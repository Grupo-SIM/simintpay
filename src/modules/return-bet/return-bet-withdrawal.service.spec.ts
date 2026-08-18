import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReturnBetWithdrawalService } from './return-bet-withdrawal.service';

const input = {
  requestId: 'return-request-1',
  externalUserId: 'return-user-1',
  name: 'Cliente Teste',
  email: 'cliente@example.com',
  document: '11122233344',
  availableBalance: 150,
  amount: 120,
  pixKey: 'cliente@example.com',
};

function withdrawal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sim-withdraw-1',
    userId: 'sim-user-1',
    integrationRequestId: input.requestId,
    grossAmount: new Prisma.Decimal(120),
    amount: new Prisma.Decimal(118),
    fee: new Prisma.Decimal(2),
    pixKey: input.pixKey,
    status: 'PENDING',
    receiptImage: null,
    rejectionReason: null,
    reviewedAt: null,
    reviewSource: null,
    reviewedByReference: null,
    createdAt: new Date('2026-08-18T12:00:00.000Z'),
    updatedAt: new Date('2026-08-18T12:00:00.000Z'),
    ...overrides,
  };
}

function makePrisma() {
  const prisma: any = {
    returnBetAccount: {
      findUnique: jest.fn().mockResolvedValue({ id: 'account-1', userId: 'sim-user-1' }),
      update: jest.fn().mockResolvedValue({ id: 'account-1', userId: 'sim-user-1' }),
    },
    withdrawRequest: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findFirstOrThrow: jest.fn().mockResolvedValue(withdrawal()),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(withdrawal()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    wallet: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        balance: new Prisma.Decimal(150),
        lockedBalance: new Prisma.Decimal(0),
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        balance: new Prisma.Decimal(150),
        lockedBalance: new Prisma.Decimal(120),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    balanceLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  prisma.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prisma));
  return prisma;
}

describe('ReturnBetWithdrawalService', () => {
  it('creates an idempotent pending request and applies the R$2 fee', async () => {
    const prisma = makePrisma();
    const service = new ReturnBetWithdrawalService(prisma);

    const result = await service.request(input);

    expect(result.netAmount).toBe(118);
    expect(prisma.withdrawRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        integrationRequestId: input.requestId,
        grossAmount: 120,
        amount: 118,
        fee: 2,
        platform: 'return-bet',
      }),
    });
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: { balance: 150, lockedBalance: 120, version: { increment: 1 } },
    });
  });

  it('returns the existing record for the same request id', async () => {
    const prisma = makePrisma();
    prisma.withdrawRequest.findUnique.mockResolvedValue(withdrawal());
    const service = new ReturnBetWithdrawalService(prisma);

    const result = await service.request(input);

    expect(result.id).toBe('sim-withdraw-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects amount below R$100 or above the source balance', async () => {
    const service = new ReturnBetWithdrawalService(makePrisma());

    await expect(service.request({ ...input, amount: 99 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(
      service.request({ ...input, amount: 151 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a second non-rejected request within 30 days', async () => {
    const prisma = makePrisma();
    prisma.withdrawRequest.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(withdrawal({ status: 'APPROVED' }));
    const service = new ReturnBetWithdrawalService(prisma);

    await expect(service.request(input)).rejects.toBeInstanceOf(ConflictException);
  });

  it('approves once and debits total and locked balances', async () => {
    const prisma = makePrisma();
    prisma.withdrawRequest.findFirstOrThrow
      .mockResolvedValueOnce(withdrawal())
      .mockResolvedValueOnce(withdrawal({ status: 'APPROVED' }));
    const service = new ReturnBetWithdrawalService(prisma);

    const result = await service.approve(input.requestId, 'https://receipt.test/file', {
      actorReference: 'admin-1',
    });

    expect(result.status).toBe('APPROVED');
    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sim-withdraw-1', status: 'PENDING' } }),
    );
    expect(prisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          balance: { decrement: new Prisma.Decimal(120) },
          lockedBalance: { decrement: new Prisma.Decimal(120) },
        }),
      }),
    );
  });

  it('rejects a conflicting terminal transition', async () => {
    const prisma = makePrisma();
    prisma.withdrawRequest.findFirstOrThrow.mockResolvedValue(withdrawal({ status: 'APPROVED' }));
    const service = new ReturnBetWithdrawalService(prisma);

    await expect(
      service.reject(input.requestId, 'Dados inválidos', { actorReference: 'admin-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
