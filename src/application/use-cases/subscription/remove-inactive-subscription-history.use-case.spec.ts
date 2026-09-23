import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RemoveInactiveSubscriptionHistoryUseCase } from './remove-inactive-subscription-history.use-case';

describe('RemoveInactiveSubscriptionHistoryUseCase', () => {
  const originalDomToken = process.env.DOM_TOKEN;

  beforeEach(() => {
    process.env.DOM_TOKEN = 'dom-token';
  });

  afterAll(() => {
    process.env.DOM_TOKEN = originalDomToken;
  });

  const masterUser = {
    id: 'master-user',
    role: 'ADMIN',
    email: 'master@simintpay.com',
    tenantModule: { slug: 'master', name: 'Master' },
  };

  function makeSut(subscription: Record<string, unknown>, requester = masterUser) {
    const gateway = { getSubscription: jest.fn().mockResolvedValue(subscription) };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(requester) },
      subscriptionPause: { findUnique: jest.fn().mockResolvedValue(null) },
      subscriptionHistoryExclusion: { upsert: jest.fn().mockResolvedValue({}) },
    };
    return {
      gateway,
      prisma,
      sut: new RemoveInactiveSubscriptionHistoryUseCase(gateway as any, prisma as any),
    };
  }

  it('persists an inactive subscription exclusion requested by the master admin', async () => {
    const { sut, prisma } = makeSut({ data: { status: 'CANCELLED' } });

    await expect(sut.execute({ userId: 'master-user', domSubscriptionId: 'sub-old' })).resolves.toEqual({ removed: true });

    expect(prisma.subscriptionHistoryExclusion.upsert).toHaveBeenCalledWith({
      where: { domSubscriptionId: 'sub-old' },
      create: { domSubscriptionId: 'sub-old', removedByUserId: 'master-user' },
      update: { removedByUserId: 'master-user' },
    });
  });

  it('refuses to remove an active subscription from history', async () => {
    const { sut, prisma } = makeSut({ data: { status: 'ACTIVE' } });

    await expect(sut.execute({ userId: 'master-user', domSubscriptionId: 'sub-active' }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.subscriptionHistoryExclusion.upsert).not.toHaveBeenCalled();
  });

  it('refuses a non-master admin before changing history', async () => {
    const { sut, prisma } = makeSut(
      { data: { status: 'CANCELLED' } },
      { ...masterUser, id: 'tenant-admin', tenantModule: { slug: 'areaflix', name: 'Areaflix' } },
    );

    await expect(sut.execute({ userId: 'tenant-admin', domSubscriptionId: 'sub-old' }))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.subscriptionHistoryExclusion.upsert).not.toHaveBeenCalled();
  });

  it('refuses to remove a paused subscription from history', async () => {
    const { sut, prisma } = makeSut({ data: { status: 'CANCELLED' } });
    prisma.subscriptionPause.findUnique.mockResolvedValue({ domSubscriptionId: 'sub-paused' });

    await expect(sut.execute({ userId: 'master-user', domSubscriptionId: 'sub-paused' }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.subscriptionHistoryExclusion.upsert).not.toHaveBeenCalled();
  });
});
