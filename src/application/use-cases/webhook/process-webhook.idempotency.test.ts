import { describe, test, expect, mock } from 'bun:test';
import { Prisma } from '@prisma/client';
import { ProcessWebhookUseCase } from './process-webhook.use-case';

function fixture(claimCount = 1) {
  const payment = { id: 'a'.repeat(64), userId: 'original-owner', status: 'PENDING', description: '[TENANT:CLIENT]', netAmount: new Prisma.Decimal(90), platformFee: new Prisma.Decimal(9) };
  const wallet = { id: 'wallet', balance: new Prisma.Decimal(10), lockedBalance: new Prisma.Decimal(0), version: 0 };
  const tx = {
    transaction: { updateMany: mock(async () => ({ count: claimCount })) },
    wallet: { findUnique: mock(async () => wallet), updateMany: mock(async () => ({ count: 1 })) },
    transactionStatusHistory: { create: mock(async () => ({})) }, balanceLog: { create: mock(async () => ({})) },
  };
  const events = { findByEventId: mock(async () => null), create: mock(async () => ({ id: 'event' })), markProcessed: mock(async () => {}), markFailed: mock(async () => {}) };
  const affiliates = { applyForTransaction: mock(async () => {}), reverseForTransaction: mock(async () => {}) };
  const prisma = { user: { findUnique: mock(async () => ({ tenantModule: null })) }, $transaction: mock(async (fn: any) => fn(tx)) };
  const service = new ProcessWebhookUseCase(events as never, { findByDomPaymentId: async () => payment } as never, {} as never, prisma as never, {} as never, affiliates as never);
  return { service, tx, affiliates };
}
const payload = { event: 'transaction', signature: 'event1', data: { paymentId: 'payment', status: 'paid', amountWithoutAllFee: 999 } };

describe('Canonical webhook financial integrity', () => {
  test('uses persisted net cents contract and original transaction wallet', async () => {
    const { service, tx } = fixture();
    await service.execute({ payload });
    expect(tx.wallet.findUnique).toHaveBeenCalledWith({ where: { userId: 'original-owner' } });
    expect((tx.wallet.updateMany.mock.calls as any)[0][0].data.balance.toNumber()).toBe(100);
  });
  test('losing concurrent status claim skips wallet, history, commission and notifications', async () => {
    const { service, tx, affiliates } = fixture(0);
    await service.execute({ payload });
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.transactionStatusHistory.create).not.toHaveBeenCalled();
    expect(affiliates.applyForTransaction).not.toHaveBeenCalled();
  });
});
