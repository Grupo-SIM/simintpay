import { ReturnBetCommunityStatusService } from './return-bet-community-status.service';

const NOW = new Date('2026-08-18T12:00:00.000Z');

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    currentPeriodEndsAt: new Date('2026-09-01T12:00:00.000Z'),
    issueStartedAt: null,
    cancelledAt: null,
    domSubscriptionId: 'sub-1',
    ...overrides,
  };
}

function makePrismaMock(orders: ReturnType<typeof makeOrder>[]) {
  return {
    subscriptionLink: {
      findFirst: jest.fn().mockResolvedValue({ id: 'link-1', frequencyType: 'MONTHLY' }),
    },
    subscriptionLinkOrder: {
      findMany: jest.fn().mockResolvedValue(orders),
    },
  } as any;
}

describe('ReturnBetCommunityStatusService', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('returns active membership with its period end', async () => {
    const service = new ReturnBetCommunityStatusService(makePrismaMock([makeOrder()]));

    await expect(service.checkOne({ cpf: '111.222.333-44' })).resolves.toEqual({
      isActive: true,
      expiresAt: '2026-09-01T12:00:00.000Z',
      membershipStatus: 'ACTIVE',
      periodEndsAt: '2026-09-01T12:00:00.000Z',
      issueStartedAt: null,
    });
  });

  it('preserves the paid period when cancelled', async () => {
    const service = new ReturnBetCommunityStatusService(
      makePrismaMock([
        makeOrder({
          status: 'cancelled',
          cancelledAt: new Date('2026-08-15T12:00:00.000Z'),
        }),
      ]),
    );

    const result = await service.checkOne({ cpf: '11122233344' });

    expect(result.membershipStatus).toBe('CANCELLED');
    expect(result.periodEndsAt).toBe('2026-09-01T12:00:00.000Z');
    expect(result.issueStartedAt).toBe('2026-08-15T12:00:00.000Z');
  });

  it('reports payment failure and its grace start', async () => {
    const issueStartedAt = new Date('2026-08-17T12:00:00.000Z');
    const service = new ReturnBetCommunityStatusService(
      makePrismaMock([makeOrder({ status: 'payment_failed', issueStartedAt })]),
    );

    const result = await service.checkOne({ email: 'user@example.com' });

    expect(result.membershipStatus).toBe('PAYMENT_FAILED');
    expect(result.issueStartedAt).toBe(issueStartedAt.toISOString());
  });

  it('marks an active-looking subscription expired after period end', async () => {
    const service = new ReturnBetCommunityStatusService(
      makePrismaMock([
        makeOrder({ currentPeriodEndsAt: new Date('2026-08-10T12:00:00.000Z') }),
      ]),
    );

    expect((await service.checkOne({ cpf: '11122233344' })).membershipStatus).toBe('EXPIRED');
  });

  it('returns not found when no matching order exists', async () => {
    const service = new ReturnBetCommunityStatusService(makePrismaMock([]));

    expect((await service.checkOne({ cpf: '00000000000' })).membershipStatus).toBe('NOT_FOUND');
  });

  it('returns not found when the Vivendo de Bet link does not exist', async () => {
    const prisma = makePrismaMock([]);
    prisma.subscriptionLink.findFirst.mockResolvedValue(null);
    const service = new ReturnBetCommunityStatusService(prisma);

    const result = await service.checkOne({ cpf: '11122233344' });

    expect(result.membershipStatus).toBe('NOT_FOUND');
    expect(prisma.subscriptionLinkOrder.findMany).not.toHaveBeenCalled();
  });
});
