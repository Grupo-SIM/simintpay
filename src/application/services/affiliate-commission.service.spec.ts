import { Prisma } from '@prisma/client';
import { AffiliateCommissionService } from './affiliate-commission.service';

function buildPrismaMock(overrides: any = {}) {
  return {
    user: {
      findUnique: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    balanceLog: {
      create: jest.fn(),
    },
    affiliateCommission: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  };
}

describe('AffiliateCommissionService.applyForTransaction', () => {
  const svc = new AffiliateCommissionService();

  it('não faz nada se a conta não tem afiliado vinculado', async () => {
    const p = buildPrismaMock({
      user: {
        findUnique: jest.fn().mockResolvedValue({ referredByUserId: null }),
      },
    });

    await svc.applyForTransaction(p, {
      transactionId: 'tx1',
      referredUserId: 'referred1',
      platformFee: new Prisma.Decimal(10),
    });

    expect(p.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('não faz nada se o afiliado vinculado está com isAffiliate=false', async () => {
    const p = buildPrismaMock({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ referredByUserId: 'aff1' })
          .mockResolvedValueOnce({
            isAffiliate: false,
            affiliateCommissionPercent: new Prisma.Decimal(10),
          }),
      },
    });

    await svc.applyForTransaction(p, {
      transactionId: 'tx1',
      referredUserId: 'referred1',
      platformFee: new Prisma.Decimal(10),
    });

    expect(p.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('credita commissionAmount = platformFee * percent/100 na wallet do afiliado', async () => {
    const p = buildPrismaMock({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ referredByUserId: 'aff1' })
          .mockResolvedValueOnce({
            isAffiliate: true,
            affiliateCommissionPercent: new Prisma.Decimal(20),
          }),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'wallet-aff1',
          userId: 'aff1',
          balance: new Prisma.Decimal(100),
          lockedBalance: new Prisma.Decimal(0),
          version: 3,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      affiliateCommission: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    });

    await svc.applyForTransaction(p, {
      transactionId: 'tx1',
      referredUserId: 'referred1',
      platformFee: new Prisma.Decimal(10),
    });

    expect(p.wallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'wallet-aff1', version: 3 },
      data: { balance: new Prisma.Decimal(102), version: { increment: 1 } },
    });
    expect(p.balanceLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'aff1',
        transactionId: 'tx1',
        amount: new Prisma.Decimal(2),
        source: 'AFFILIATE_COMMISSION',
      }),
    });
    expect(p.affiliateCommission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affiliateUserId: 'aff1',
        referredUserId: 'referred1',
        transactionId: 'tx1',
        percentApplied: new Prisma.Decimal(20),
        grossPlatformFee: new Prisma.Decimal(10),
        commissionAmount: new Prisma.Decimal(2),
        status: 'CREDITED',
      }),
    });
  });

  it('não credita de novo se já existe AffiliateCommission pra essa transação', async () => {
    const p = buildPrismaMock({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ referredByUserId: 'aff1' })
          .mockResolvedValueOnce({
            isAffiliate: true,
            affiliateCommissionPercent: new Prisma.Decimal(20),
          }),
      },
      affiliateCommission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
      },
    });

    await svc.applyForTransaction(p, {
      transactionId: 'tx1',
      referredUserId: 'referred1',
      platformFee: new Prisma.Decimal(10),
    });

    expect(p.wallet.findUnique).not.toHaveBeenCalled();
  });
});

describe('AffiliateCommissionService.reverseForTransaction', () => {
  const svc = new AffiliateCommissionService();

  it('não faz nada se não existe comissão CREDITED pra essa transação', async () => {
    const p = buildPrismaMock({
      affiliateCommission: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await svc.reverseForTransaction(p, 'tx1');

    expect(p.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('debita o commissionAmount exato e marca REVERSED', async () => {
    const p = buildPrismaMock({
      affiliateCommission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comm1',
          affiliateUserId: 'aff1',
          commissionAmount: new Prisma.Decimal(2),
          status: 'CREDITED',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'wallet-aff1',
          userId: 'aff1',
          balance: new Prisma.Decimal(102),
          lockedBalance: new Prisma.Decimal(0),
          version: 4,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await svc.reverseForTransaction(p, 'tx1');

    expect(p.wallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'wallet-aff1', version: 4 },
      data: { balance: new Prisma.Decimal(100), version: { increment: 1 } },
    });
    expect(p.affiliateCommission.update).toHaveBeenCalledWith({
      where: { id: 'comm1' },
      data: { status: 'REVERSED', reversedAt: expect.any(Date) },
    });
  });
});
