import { afterEach, describe, expect, mock, test } from 'bun:test';
import { ReconcilePendingTransactionsUseCase } from './reconcile-pending-transactions.use-case';

const originalToken = process.env.DOM_TOKEN;
afterEach(() => {
  if (originalToken === undefined) delete process.env.DOM_TOKEN;
  else process.env.DOM_TOKEN = originalToken;
});

function fixture(dom: Record<string, unknown>, settledStatus = 'COMPLETED') {
  process.env.DOM_TOKEN = 'local-test-token';
  const prisma = {
    transaction: {
      findMany: mock(async (): Promise<{ id: string; userId: string; domPaymentId: string; domTransactionId: string }[]> => [{
        id: 'local-id', userId: 'seller', domPaymentId: 'reference-id', domTransactionId: 'provider-id',
      }]),
      findUnique: mock(async () => ({ status: settledStatus })),
    },
  };
  const gateway = {
    listDomTransactions: mock(async () => ({ transactions: [dom] })),
    getDomTransactionDetail: mock(async () => dom),
  };
  const webhook = { execute: mock(async (_payload: unknown) => undefined) };
  const useCase = new ReconcilePendingTransactionsUseCase(prisma as never, gateway as never, webhook as never);
  return { useCase, prisma, gateway, webhook };
}

describe('pending DOM reconciliation', () => {
  test('checks payments older than one minute and reuses webhook with stored payment reference', async () => {
    const { useCase, prisma, webhook } = fixture({ id: 'provider-id', order_id: 'reference-id', status: 'approved' });
    const before = Date.now();
    const result = await useCase.execute();
    const cutoff = prisma.transaction.findMany.mock.calls[0] as unknown as [{ where: { updatedAt: { lte: Date } } }];
    expect(cutoff[0].where.updatedAt.lte.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    expect(cutoff[0].where.updatedAt.lte.getTime()).toBeLessThanOrEqual(Date.now() - 60_000);
    expect(result.completed).toBe(1);
    expect(webhook.execute).toHaveBeenCalledWith(expect.objectContaining({
      signature: 'reconcile:reference-id',
      data: expect.objectContaining({ id: 'reference-id', status: 'approved' }),
    }));
  });

  test('matches provider transaction ID when DOM omits payment reference', async () => {
    const { useCase, webhook } = fixture({ id: 'provider-id', status: 'paid' });
    expect((await useCase.execute()).completed).toBe(1);
    expect(webhook.execute).toHaveBeenCalledTimes(1);
  });

  test('matches local external reference when DOM IDs differ', async () => {
    const { useCase } = fixture({ id: 'another-provider-id', cod_external: 'local-id', status: 'paid' });
    expect((await useCase.execute()).completed).toBe(1);
  });

  test('does not report completion when webhook did not settle payment', async () => {
    const { useCase } = fixture({ id: 'reference-id', status: 'paid' }, 'PENDING');
    const result = await useCase.execute();
    expect(result.completed).toBe(0);
    expect(result.details[0].action).toBe('kept-pending');
  });

  test('leaves unpaid transactions pending without processing webhook', async () => {
    const { useCase, webhook, prisma } = fixture({ id: 'reference-id', status: 'pending' });
    expect((await useCase.execute()).completed).toBe(0);
    expect(webhook.execute).not.toHaveBeenCalled();
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
  });
});

describe('fast direct DOM polling', () => {
  test('reads normalized approval directly and restricts polling to first 30 minutes', async () => {
    const { useCase, gateway, prisma, webhook } = fixture({ order: { type: 'approved', total: 8.5 } });
    const before = Date.now();
    await useCase.pollRecentPayments();
    expect(gateway.getDomTransactionDetail).toHaveBeenCalledWith('local-test-token', 'reference-id');
    expect(gateway.listDomTransactions).not.toHaveBeenCalled();
    const calls = prisma.transaction.findMany.mock.calls as unknown as [[{ where: {
      status: string; createdAt: { gte: Date }; updatedAt: { lte: Date };
    } }]];
    expect(calls[0][0].where.status).toBe('PENDING');
    expect(calls[0][0].where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(before - 30 * 60_000);
    expect(calls[0][0].where.updatedAt.lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(webhook.execute).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: 'reference-id', status: 'approved', amount: 850 }),
    }));
  });

  test('stops requesting DOM when no eligible pending payments remain', async () => {
    const { useCase, prisma, gateway } = fixture({ order: { type: 'paid' } });
    prisma.transaction.findMany.mockImplementation(async () => []);
    await useCase.pollRecentPayments();
    expect(gateway.getDomTransactionDetail).not.toHaveBeenCalled();
    expect(gateway.listDomTransactions).not.toHaveBeenCalled();
  });

  test('does not confirm pending direct response', async () => {
    const { useCase, webhook } = fixture({ order: { type: 'pending' } });
    await useCase.pollRecentPayments();
    expect(webhook.execute).not.toHaveBeenCalled();
  });

  test('retries on next polling cycle after temporary DOM failure', async () => {
    const { useCase, gateway, webhook } = fixture({ order: { type: 'paid' } });
    gateway.getDomTransactionDetail.mockImplementationOnce(async () => { throw new Error('timeout'); });
    await useCase.pollRecentPayments();
    expect(webhook.execute).not.toHaveBeenCalled();
    await useCase.pollRecentPayments();
    expect(webhook.execute).toHaveBeenCalledTimes(1);
  });
});
