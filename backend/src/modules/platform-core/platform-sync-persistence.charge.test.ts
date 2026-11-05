import { describe, test, expect, mock } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformSyncPersistenceService } from './platform-sync-persistence.service';
import { PlatformEventsService } from './platform-events.service';

const TX = 'final-net-tx';

function fixture() {
  const charge = {
    transactionId: TX,
    status: 'PENDING',
    paidAt: null as Date | null,
  };
  const row: any = {
    id: TX,
    status: 'PENDING',
    userId: 'owner',
    acquirer: 'DOM',
    description: '[TENANT:ATLAS]',
    platformTag: 'ATLAS',
    settlementBasis: 'FINAL_NET',
    domPaymentId: 'gateway',
    amount: new Prisma.Decimal(100),
    netAmount: new Prisma.Decimal(97),
  };
  const tx: any = {
    platform: {
      findUnique: mock(async () => ({
        ownerUserId: 'owner',
        isActive: true,
        owner: { isActive: true, isPurged: false },
      })),
    },
    transaction: {
      findFirst: mock(async () => ({ ...row })),
      updateMany: mock(async ({ where, data }: any) => {
        if (where.id !== row.id || where.status !== row.status)
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    charge: {
      updateMany: mock(async ({ where, data }: any) => {
        if (
          where.transactionId !== charge.transactionId ||
          (where.status && where.status !== charge.status)
        )
          return { count: 0 };
        Object.assign(charge, data);
        return { count: 1 };
      }),
    },
    user: { findUnique: mock(async () => null) },
    affiliateCommission: {
      findUnique: mock(async () => null),
      findMany: mock(async () => []),
    },
    transactionStatusHistory: { create: mock(async () => ({})) },
    wallet: {
      findUnique: mock(async () => ({ id: 'wallet' })),
      upsert: mock(async () => ({})),
      update: mock(async () => ({})),
      findUniqueOrThrow: mock(async () => ({
        balance: new Prisma.Decimal(0),
        lockedBalance: new Prisma.Decimal(0),
      })),
    },
    balanceLog: {
      create: mock(async () => ({})),
      findFirst: mock(async () => null),
    },
  };
  const prisma = { $transaction: mock(async (fn: any) => fn(tx)) };
  const service = new PlatformSyncPersistenceService(
    prisma as never,
    new PlatformEventsService(),
    {} as never,
  );
  const persist = (status: string) =>
    (service as any).persist(
      { id: 'platform', tag: 'ATLAS', ownerUserId: 'owner' },
      { id: 'gateway', status, amount: 100, liquid_amount: 97 },
      'atlas',
    );
  return { persist, charge, row };
}

describe('Polling settles the Charge of a FINAL_NET Transaction', () => {
  test('paid marks the Charge PAID; a repeated poll changes nothing', async () => {
    const { persist, charge } = fixture();
    await persist('paid');
    expect(charge.status).toBe('PAID');
    const paidAt = charge.paidAt;
    expect(paidAt).toBeInstanceOf(Date);

    await persist('paid');
    expect(charge.status).toBe('PAID');
    expect(charge.paidAt).toBe(paidAt);
  });

  test('failed marks the Charge FAILED; a refund after payment keeps it PAID', async () => {
    const failed = fixture();
    await failed.persist('failed');
    expect(failed.charge.status).toBe('FAILED');

    const refunded = fixture();
    await refunded.persist('paid');
    await refunded.persist('refunded');
    expect(refunded.row.status).toBe('REFUNDED');
    expect(refunded.charge.status).toBe('PAID');
  });
});
