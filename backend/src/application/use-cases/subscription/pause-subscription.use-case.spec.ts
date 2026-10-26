import { BadRequestException } from '@nestjs/common';
import { PauseSubscriptionUseCase } from './pause-subscription.use-case';

describe('PauseSubscriptionUseCase', () => {
  const originalDomToken = process.env.DOM_TOKEN;

  beforeEach(() => {
    process.env.DOM_TOKEN = 'dom-token';
  });

  afterAll(() => {
    process.env.DOM_TOKEN = originalDomToken;
  });

  it('rejects an inactive subscription even when it has a future invoice date', async () => {
    const gateway = {
      getSubscription: jest.fn().mockResolvedValue({
        data: {
          status: 'CANCELLED',
          auto_recurring: { next_date_invoice: '2030-01-01T00:00:00.000Z' },
        },
      }),
      cancelSubscription: jest.fn(),
    };
    const prisma = {
      subscriptionPause: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const sut = new PauseSubscriptionUseCase(gateway as any, prisma as any);

    await expect(sut.execute({ userId: 'admin', role: 'ADMIN', domSubscriptionId: 'sub-cancelled' }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(gateway.cancelSubscription).not.toHaveBeenCalled();
  });

  it('accepts an active DOM subscription represented by active=true', async () => {
    const gateway = {
      getSubscription: jest.fn().mockResolvedValue({
        data: {
          active: true,
          auto_recurring: { next_date_invoice: '2030-01-01T00:00:00.000Z' },
        },
      }),
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      subscriptionPause: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const sut = new PauseSubscriptionUseCase(gateway as any, prisma as any);

    await expect(sut.execute({ userId: 'admin', role: 'ADMIN', domSubscriptionId: 'sub-active' }))
      .resolves.toEqual(expect.objectContaining({ remainingDays: expect.any(Number) }));
  });
});
