import { describe, expect, mock, test } from 'bun:test';
import { ProcessDomWebhookUseCase } from './process-dom-webhook.use-case';

const payload = { event: 'charge', signature: 'signature-1', data: { id: 'payment-1', amount: 100, status: 'paid' } };

function fixture(status: string) {
  const prisma = {
    webhookEvent: {
      findFirst: mock(async () => ({ id: 'event-1', status })),
      create: mock(async () => ({ id: 'new-event' })),
      update: mock(async () => ({})),
    },
    subscriptionLinkOrder: { findFirst: mock(async () => null) },
    transaction: { findFirst: mock(async () => ({ id: 'transaction-1', status: 'COMPLETED', userId: 'merchant-1' })) },
    $transaction: mock(async () => undefined),
  };
  const useCase = new ProcessDomWebhookUseCase(prisma as never, {} as never, {} as never);
  return { useCase, prisma };
}

describe('DOM webhook redelivery', () => {
  test('resumes failed event without creating duplicate event or crediting settled transaction', async () => {
    const { useCase, prisma } = fixture('FAILED');
    await useCase.execute(payload);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: 'PROCESSED', processedAt: expect.any(Date), error: null },
    });
  });

  test('ignores processed signatures', async () => {
    const { useCase, prisma } = fixture('PROCESSED');
    await useCase.execute(payload);
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).not.toHaveBeenCalled();
  });

  test('propagates failure to queue after recording failed event', async () => {
    const { useCase, prisma } = fixture('FAILED');
    prisma.transaction.findFirst.mockImplementation(async () => { throw new Error('database unavailable'); });
    await expect(useCase.execute(payload)).rejects.toThrow('database unavailable');
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: 'FAILED', error: 'database unavailable', retryCount: { increment: 1 } },
    });
  });
});
