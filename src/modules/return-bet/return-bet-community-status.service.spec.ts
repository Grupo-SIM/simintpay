import { ReturnBetCommunityStatusService } from './return-bet-community-status.service';

function makePrismaMock(order: any) {
  return {
    subscriptionLink: {
      findFirst: jest.fn().mockResolvedValue({ id: 'link-1' }),
    },
    subscriptionLinkOrder: {
      findFirst: jest.fn().mockResolvedValue(order),
    },
  } as any;
}

describe('ReturnBetCommunityStatusService', () => {
  it('returns isActive=true when the most recent order for the CPF has status active', async () => {
    const prisma = makePrismaMock({ status: 'active' });
    const service = new ReturnBetCommunityStatusService(prisma);

    const result = await service.checkOne({ cpf: '11122233344' });

    expect(result).toEqual({ isActive: true, expiresAt: null });
    expect(prisma.subscriptionLinkOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subscriptionLinkId: 'link-1',
          customerDocument: '11122233344',
        }),
      }),
    );
  });

  it('returns isActive=false when no order matches', async () => {
    const prisma = makePrismaMock(null);
    const service = new ReturnBetCommunityStatusService(prisma);

    const result = await service.checkOne({ cpf: '00000000000' });

    expect(result).toEqual({ isActive: false, expiresAt: null });
  });

  it('is case-insensitive on the status value', async () => {
    const prisma = makePrismaMock({ status: 'ACTIVE' });
    const service = new ReturnBetCommunityStatusService(prisma);

    const result = await service.checkOne({ cpf: '11122233344' });

    expect(result.isActive).toBe(true);
  });

  it('falls back to email when cpf is not provided', async () => {
    const prisma = makePrismaMock({ status: 'active' });
    const service = new ReturnBetCommunityStatusService(prisma);

    await service.checkOne({ email: 'user@example.com' });

    expect(prisma.subscriptionLinkOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerEmail: 'user@example.com' }),
      }),
    );
  });

  it('returns isActive=false when the SubscriptionLink itself is not found', async () => {
    const prisma = {
      subscriptionLink: { findFirst: jest.fn().mockResolvedValue(null) },
      subscriptionLinkOrder: { findFirst: jest.fn() },
    } as any;
    const service = new ReturnBetCommunityStatusService(prisma);

    const result = await service.checkOne({ cpf: '11122233344' });

    expect(result).toEqual({ isActive: false, expiresAt: null });
    expect(prisma.subscriptionLinkOrder.findFirst).not.toHaveBeenCalled();
  });
});
