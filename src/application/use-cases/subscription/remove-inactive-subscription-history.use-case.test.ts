import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { RemoveInactiveSubscriptionHistoryUseCase } from './remove-inactive-subscription-history.use-case';

describe('Safe subscriber history removal', () => {
  const originalDomToken = process.env.DOM_TOKEN;
  beforeEach(() => { process.env.DOM_TOKEN = 'local-test'; });
  afterAll(() => { process.env.DOM_TOKEN = originalDomToken; });
  const masterUser = {
    id: 'master-user',
    role: 'ADMIN',
    email: 'master@simintpay.com',
    platform: { tag: 'master', name: 'Master' },
  };

  function makeSut(subscription: Record<string, unknown>, requester = masterUser) {
    const gateway = { getSubscription: mock().mockResolvedValue(subscription) };
    const prisma = {
      user: { findUnique: mock().mockResolvedValue(requester) },
      subscriptionPause: { findUnique: mock().mockResolvedValue(null) },
      subscriptionHistoryExclusion: { upsert: mock().mockResolvedValue({}) },
    };
    return {
      gateway,
      prisma,
      sut: new RemoveInactiveSubscriptionHistoryUseCase(gateway as any, prisma as any),
    };
  }

  test.each(['', 'NEW_STATE', 'PAUSED', 'PENDING', 'ACTIVATED'])('refuses unsafe provider state %s', async status => {
    const { sut, prisma } = makeSut({ data: { status } });
    await expect(sut.execute({ userId: 'master-user', domSubscriptionId: 'sub' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscriptionHistoryExclusion.upsert).not.toHaveBeenCalled();
  });

  test('rechecks provider state after listing, preventing removal of reactivated subscriptions', async () => {
    const { sut, gateway, prisma } = makeSut({ data: { status: 'CANCELLED' } });
    gateway.getSubscription.mockResolvedValueOnce({ data: { status: 'ACTIVE' } });
    await expect(sut.execute({ userId: 'master-user', domSubscriptionId: 'sub' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscriptionHistoryExclusion.upsert).not.toHaveBeenCalled();
  });

  test('blocks a pause recorded while the provider request is in flight', async () => {
    const { sut, prisma } = makeSut({ data: { status: 'CANCELLED' } });
    prisma.subscriptionPause.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ domSubscriptionId: 'sub' });
    await expect(sut.execute({ userId: 'master-user', domSubscriptionId: 'sub' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscriptionHistoryExclusion.upsert).not.toHaveBeenCalled();
  });

});
