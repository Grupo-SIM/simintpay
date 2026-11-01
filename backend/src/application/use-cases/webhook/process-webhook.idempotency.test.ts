import { initializePlatformTaxasCache } from '../../../modules/platform-taxas/platform-taxas.store';
import { beforeAll, describe, test, expect, mock } from 'bun:test';
import { Prisma } from '@prisma/client';
import { ProcessWebhookUseCase } from './process-webhook.use-case';

beforeAll(async () =>
  initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as any),
);

function fixture(claimCount = 1, status = 'PENDING') {
  const payment = {
    id: 'a'.repeat(64),
    userId: 'original-owner',
    status,
    description: '[TENANT:CLIENT]',
    netAmount: new Prisma.Decimal(90),
    platformFee: new Prisma.Decimal(9),
  };
  const wallet = {
    id: 'wallet',
    balance: new Prisma.Decimal(10),
    lockedBalance: new Prisma.Decimal(0),
    version: 0,
  };
  const tx = {
    transaction: { updateMany: mock(async () => ({ count: claimCount })) },
    wallet: {
      findUnique: mock(async () => wallet),
      findUniqueOrThrow: mock(async () => wallet),
    },
    transactionStatusHistory: { create: mock(async () => ({})) },
    balanceLog: { create: mock(async () => ({})) },
  };
  const events = {
    findByEventId: mock(async () => null),
    create: mock(async () => ({ id: 'event' })),
    markProcessed: mock(async () => {}),
    markFailed: mock(async () => {}),
  };
  const affiliates = {
    applyForTransaction: mock(async () => {}),
    reverseForTransaction: mock(async () => {}),
  };
  const prisma = {
    user: { findUnique: mock(async () => ({ platform: null })) },
    $transaction: mock(async (fn: any) => fn(tx)),
  };
  const service = new ProcessWebhookUseCase(
    events as never,
    { findByDomPaymentId: async () => payment } as never,
    {} as never,
    prisma as never,
    {} as never,
    affiliates as never,
  );
  return { service, tx, affiliates, payment };
}
const payload = {
  event: 'transaction',
  signature: 'event1',
  data: { paymentId: 'payment', status: 'paid', amountWithoutAllFee: 999 },
};

describe('Canonical webhook financial integrity', () => {
  test('uses persisted net cents contract and original transaction wallet', async () => {
    const { service, tx } = fixture();
    await service.execute({ payload });
    expect(tx.wallet.findUnique).toHaveBeenCalledWith({
      where: { userId: 'original-owner' },
    });
    expect(
      (
        tx.balanceLog.create.mock.calls as any
      )[0][0].data.balanceDelta.toNumber(),
    ).toBe(90);
  });
  test('immediate paid event can settle draft without an intermediate pending event', async () => {
    const { service, tx } = fixture(1, 'DRAFT');
    await service.execute({ payload });
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'a'.repeat(64), status: 'DRAFT' },
      data: { previousStatus: 'DRAFT', status: 'COMPLETED' },
    });
    expect(
      (
        tx.balanceLog.create.mock.calls as any
      )[0][0].data.balanceDelta.toNumber(),
    ).toBe(90);
  });
  test('losing concurrent status claim skips wallet, history, commission and notifications', async () => {
    const { service, tx, affiliates } = fixture(0);
    await service.execute({ payload });
    expect(tx.balanceLog.create).not.toHaveBeenCalled();
    expect(tx.transactionStatusHistory.create).not.toHaveBeenCalled();
    expect(affiliates.applyForTransaction).not.toHaveBeenCalled();
  });
});

test('legacy UUID preserves its pre-fixed-fee provider contract', async () => {
  const { service, tx, payment } = fixture();
  payment.id = '8a8cb93a-2fbe-4a52-bd0e-1bb2971275b8';
  await service.execute({
    payload: { ...payload, data: { ...payload.data, amountWithoutAllFee: 90 } },
  });
  expect(
    (tx.balanceLog.create.mock.calls as any)[0][0].data.balanceDelta.toNumber(),
  ).toBe(86);
});
