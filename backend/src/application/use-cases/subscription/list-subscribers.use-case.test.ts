import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { ListSubscribersUseCase } from './list-subscribers.use-case';

describe('Subscriber filters before pagination', () => {
  const originalDomToken = process.env.DOM_TOKEN;
  beforeEach(() => { process.env.DOM_TOKEN = 'local-test'; });
  afterAll(() => { process.env.DOM_TOKEN = originalDomToken; });
  test('filters beyond 500 entries before pagination, including email, platform and dates', async () => {
    const items = Array.from({ length: 650 }, (_, index) => ({
      id: `sub-${index}`, status: index >= 600 ? 'CANCELLED' : 'ACTIVE',
      frequency: 'MONTHLY', interval: 1, planId: 'plan',
      name: 'Cliente', description: 'Assinatura', customer: { email: 'ana@example.com' },
      firstBillingDate: '2026-10-20T12:00:00Z',
    }));
    const gateway = { listSubscriptions: mock().mockImplementation((_token: string, { page, pageSize }: { page: number; pageSize: number }) => ({ items: items.slice((page - 1) * pageSize, page * pageSize) })) };
    const prisma = {
      subscriptionHistoryExclusion: { findMany: mock().mockResolvedValue([]) },
      subscriptionLink: { findMany: mock().mockResolvedValue([{ domPlanId: 'plan', name: 'Loja', platformTag: 'BOSQUE', plataformas: ['BOSQUE'] }]) },
      plan: { findMany: mock().mockResolvedValue([]) },
      subscriptionPause: { findMany: mock().mockResolvedValue([]) },
    };
    const sut = new ListSubscribersUseCase(gateway as any, prisma as any);
    const result = await sut.execute({ userId: 'master', role: 'ADMIN', query: {
      page: 2, pageSize: 20, statusGroup: 'deactivated', frequency: 'MONTHLY',
      search: 'ana@example.com', platform: 'BOSQUE',
      firstChargeFrom: '2026-10-20T00:00:00Z', firstChargeTo: '2026-10-20T23:59:59Z',
    } });
    expect(result.total).toBe(50);
    expect(result.hasNextPage).toBe(true);
    expect((result.data as any[]).map(row => row.id)).toEqual(items.slice(620, 640).map(row => row.id));
  });

  test('merges missing local pauses before pagination without duplicating provider rows', async () => {
    const gateway = { listSubscriptions: mock().mockResolvedValue({ items: [{ id: 'present', status: 'CANCELLED', frequency: 'YEARLY', interval: 1 }] }) };
    const pauses = [
      { domSubscriptionId: 'present', remainingDays: 2, pausedAt: new Date(), createdAt: new Date(), frequency: 'YEARLY', interval: 1 },
      { domSubscriptionId: 'missing', remainingDays: 5, pausedAt: new Date(), createdAt: new Date(), frequency: 'YEARLY', interval: 1 },
    ];
    const prisma = {
      subscriptionHistoryExclusion: { findMany: mock().mockResolvedValue([]) },
      subscriptionLink: { findMany: mock().mockResolvedValue([]) },
      plan: { findMany: mock().mockResolvedValue([]) },
      subscriptionPause: { findMany: mock().mockImplementation(({ where }: { where: { domSubscriptionId: { in?: string[]; notIn: string[] } } }) => pauses.filter(pause => where.domSubscriptionId.in ? where.domSubscriptionId.in.includes(pause.domSubscriptionId) : !where.domSubscriptionId.notIn.includes(pause.domSubscriptionId))) },
    };
    const sut = new ListSubscribersUseCase(gateway as any, prisma as any);
    const result = await sut.execute({ userId: 'master', role: 'ADMIN', query: { page: 2, pageSize: 1, statusGroup: 'paused', frequency: 'YEARLY' } });
    expect(result.total).toBe(2);
    expect(result.hasNextPage).toBe(false);
    expect(result.data).toEqual([expect.objectContaining({ id: 'missing', isPaused: true })]);
  });

  test('keeps unknown statuses in all, excludes them from deactivated and separates multi-month recurrence', async () => {
    const gateway = { listSubscriptions: mock().mockResolvedValue({ items: [
      { id: 'unknown', status: 'NEW_PROVIDER_STATE', frequency: 'MONTHLY', interval: 1 },
      { id: 'quarter', status: 'CANCELLED', frequency: 'MONTHLY', interval: 3 },
      { id: 'annual', status: 'CANCELLED', frequency: 'YEARLY', interval: 1 },
    ] }) };
    const prisma = {
      subscriptionHistoryExclusion: { findMany: mock().mockResolvedValue([]) },
      subscriptionLink: { findMany: mock().mockResolvedValue([]) },
      plan: { findMany: mock().mockResolvedValue([]) },
      subscriptionPause: { findMany: mock().mockResolvedValue([]) },
    };
    const sut = new ListSubscribersUseCase(gateway as any, prisma as any);
    expect((await sut.execute({ userId: 'master', role: 'ADMIN', query: {} })).total).toBe(3);
    expect((await sut.execute({ userId: 'master', role: 'ADMIN', query: { statusGroup: 'deactivated', frequency: 'MONTHLY' } })).total).toBe(0);
    expect((await sut.execute({ userId: 'master', role: 'ADMIN', query: { statusGroup: 'deactivated', frequency: 'YEARLY' } })).data).toEqual([expect.objectContaining({ id: 'annual' })]);
  });

});
