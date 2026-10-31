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
      updateMany: jest.fn(),
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
        balanceDelta: new Prisma.Decimal(2),
        lockedDelta: 0,
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

  it('tenta de novo em caso de conflito de versão (optimistic lock) e credita na 2ª tentativa', async () => {
    const walletFindUnique = jest
      .fn()
      // Cada tentativa relê a wallet; simula outro writer incrementando a
      // version entre a 1ª tentativa (falha) e a 2ª (sucesso).
      .mockResolvedValueOnce({
        id: 'wallet-aff1',
        userId: 'aff1',
        balance: new Prisma.Decimal(100),
        lockedBalance: new Prisma.Decimal(0),
        version: 3,
      })
      .mockResolvedValueOnce({
        id: 'wallet-aff1',
        userId: 'aff1',
        balance: new Prisma.Decimal(105),
        lockedBalance: new Prisma.Decimal(0),
        version: 4,
      });
    const walletUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 }) // 1ª tentativa perde a corrida
      .mockResolvedValueOnce({ count: 1 }); // 2ª tentativa ganha

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
      wallet: { findUnique: walletFindUnique, updateMany: walletUpdateMany },
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

    expect(walletFindUnique).toHaveBeenCalledTimes(2);
    expect(walletUpdateMany).toHaveBeenCalledTimes(2);
    expect(walletUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'wallet-aff1', version: 4 },
      data: { balance: new Prisma.Decimal(107), version: { increment: 1 } },
    });
    expect(p.affiliateCommission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'CREDITED' }),
    });
  });

  it('lança erro após esgotar as 3 tentativas por conflito de versão', async () => {
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
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      affiliateCommission: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    });

    await expect(
      svc.applyForTransaction(p, {
        transactionId: 'tx1',
        referredUserId: 'referred1',
        platformFee: new Prisma.Decimal(10),
      }),
    ).rejects.toThrow(/version conflict/i);

    expect(p.wallet.updateMany).toHaveBeenCalledTimes(3);
    expect(p.affiliateCommission.create).not.toHaveBeenCalled();
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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

    // Claims the reversal (guarded on status: 'CREDITED') before touching the wallet.
    expect(p.affiliateCommission.updateMany).toHaveBeenCalledWith({
      where: { id: 'comm1', status: 'CREDITED' },
      data: { status: 'REVERSED', reversedAt: expect.any(Date) },
    });
    expect(p.wallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'wallet-aff1', version: 4 },
      data: { balance: new Prisma.Decimal(100), version: { increment: 1 } },
    });
    expect(p.balanceLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'aff1',
        transactionId: 'tx1',
        balanceDelta: new Prisma.Decimal(-2),
        lockedDelta: 0,
        source: 'AFFILIATE_COMMISSION',
      }),
    });
  });

  it('não debita a wallet se a reversão já foi reivindicada por uma chamada concorrente (race guard)', async () => {
    const p = buildPrismaMock({
      affiliateCommission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comm1',
          affiliateUserId: 'aff1',
          commissionAmount: new Prisma.Decimal(2),
          status: 'CREDITED',
        }),
        // Simula uma segunda chamada concorrente perdendo a corrida: a linha
        // já não está mais em status CREDITED quando o updateMany roda.
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await svc.reverseForTransaction(p, 'tx1');

    expect(p.wallet.findUnique).not.toHaveBeenCalled();
    expect(p.wallet.updateMany).not.toHaveBeenCalled();
    expect(p.balanceLog.create).not.toHaveBeenCalled();
  });
});
