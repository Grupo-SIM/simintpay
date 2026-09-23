import { ListSubscribersUseCase } from './list-subscribers.use-case';

describe('ListSubscribersUseCase', () => {
  const originalDomToken = process.env.DOM_TOKEN;

  beforeEach(() => {
    process.env.DOM_TOKEN = 'dom-token';
  });

  afterAll(() => {
    process.env.DOM_TOKEN = originalDomToken;
  });

  it('does not return subscriptions excluded from the master history', async () => {
    const gateway = {
      listSubscriptions: jest.fn().mockResolvedValue({
        items: [
          { id: 'sub-hidden', status: 'CANCELLED', name: 'Teste antigo' },
          { id: 'sub-visible', status: 'ACTIVE', name: 'Cliente ativo' },
        ],
        total: 2,
      }),
    };
    const prisma = {
      subscriptionHistoryExclusion: {
        findMany: jest.fn().mockResolvedValue([{ domSubscriptionId: 'sub-hidden' }]),
      },
      subscriptionLink: { findMany: jest.fn().mockResolvedValue([]) },
      plan: { findMany: jest.fn().mockResolvedValue([]) },
      subscriptionPause: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const sut = new ListSubscribersUseCase(gateway as any, prisma as any);

    const result = await sut.execute({ userId: 'master-user', role: 'ADMIN', query: { page: 1, pageSize: 20 } });

    expect(result.data).toEqual(expect.not.arrayContaining([expect.objectContaining({ id: 'sub-hidden' })]));
    expect(result.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'sub-visible' })]));
  });

  it('fills a page with visible subscriptions after excluded history entries', async () => {
    const hidden = Array.from({ length: 20 }, (_, index) => ({
      id: `sub-hidden-${index}`,
      status: 'CANCELLED',
      name: `Teste ${index}`,
    }));
    const gateway = {
      listSubscriptions: jest.fn().mockResolvedValue({
        items: [...hidden, { id: 'sub-visible-1', status: 'ACTIVE', name: 'Cliente 1' }, { id: 'sub-visible-2', status: 'ACTIVE', name: 'Cliente 2' }],
        total: 22,
      }),
    };
    const prisma = {
      subscriptionHistoryExclusion: {
        findMany: jest.fn().mockResolvedValue(hidden.map(({ id }) => ({ domSubscriptionId: id }))),
      },
      subscriptionLink: { findMany: jest.fn().mockResolvedValue([]) },
      plan: { findMany: jest.fn().mockResolvedValue([]) },
      subscriptionPause: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const sut = new ListSubscribersUseCase(gateway as any, prisma as any);

    const result = await sut.execute({ userId: 'master-user', role: 'ADMIN', query: { page: 1, pageSize: 20 } });

    expect(result.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sub-visible-1' }),
      expect.objectContaining({ id: 'sub-visible-2' }),
    ]));
    expect(result.hasNextPage).toBe(false);
  });

  it('keeps a currently active subscription visible even if its old history was excluded', async () => {
    const gateway = {
      listSubscriptions: jest.fn().mockResolvedValue({
        items: [{ id: 'sub-reactivated', status: 'ACTIVE', name: 'Cliente reativado' }],
        total: 1,
      }),
    };
    const prisma = {
      subscriptionHistoryExclusion: {
        findMany: jest.fn().mockResolvedValue([{ domSubscriptionId: 'sub-reactivated' }]),
      },
      subscriptionLink: { findMany: jest.fn().mockResolvedValue([]) },
      plan: { findMany: jest.fn().mockResolvedValue([]) },
      subscriptionPause: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const sut = new ListSubscribersUseCase(gateway as any, prisma as any);

    const result = await sut.execute({ userId: 'master-user', role: 'ADMIN', query: { page: 1, pageSize: 20 } });

    expect(result.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'sub-reactivated' })]));
  });

  it('counts all DOM pages for accurate pagination', async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: `sub-${index}`,
      status: 'ACTIVE',
      name: `Cliente ${index}`,
    }));
    const gateway = {
      listSubscriptions: jest.fn().mockImplementation((_token: string, { page }: { page: number }) => ({
        items: page <= 10 ? items : [],
        total: 1000,
      })),
    };
    const prisma = {
      subscriptionHistoryExclusion: { findMany: jest.fn().mockResolvedValue([]) },
      subscriptionLink: { findMany: jest.fn().mockResolvedValue([]) },
      plan: { findMany: jest.fn().mockResolvedValue([]) },
      subscriptionPause: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const sut = new ListSubscribersUseCase(gateway as any, prisma as any);

    const result = await sut.execute({ userId: 'master-user', role: 'ADMIN', query: { page: 1, pageSize: 20 } });

    expect(result.total).toBe(1000);
    expect(result.hasNextPage).toBe(true);
  });

  it('does not reduce the total for an exclusion absent from the DOM list', async () => {
    const gateway = {
      listSubscriptions: jest.fn().mockResolvedValue({
        items: [{ id: 'sub-visible', status: 'ACTIVE', name: 'Cliente' }],
        total: 1,
      }),
    };
    const prisma = {
      subscriptionHistoryExclusion: {
        findMany: jest.fn().mockResolvedValue([{ domSubscriptionId: 'sub-orphan' }]),
      },
      subscriptionLink: { findMany: jest.fn().mockResolvedValue([]) },
      plan: { findMany: jest.fn().mockResolvedValue([]) },
      subscriptionPause: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const sut = new ListSubscribersUseCase(gateway as any, prisma as any);

    const result = await sut.execute({ userId: 'master-user', role: 'ADMIN', query: { page: 1, pageSize: 20 } });

    expect(result.total).toBe(1);
  });
});
