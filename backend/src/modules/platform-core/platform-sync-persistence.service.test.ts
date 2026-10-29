/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/await-thenable --
   fixtures mock Prisma and acquirer payloads with `any`. */
import { describe, test, expect, mock } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformSyncPersistenceService } from './platform-sync-persistence.service';
import { PlatformEventsService } from './platform-events.service';

function fixture(claim = 1, existingOverride = {}) {
  const existing = {
    id: 'local',
    status: 'PENDING',
    userId: 'original-owner',
    acquirer: 'DOM',
    description: '[TENANT:ATLAS]',
    amount: new Prisma.Decimal(100),
    netAmount: new Prisma.Decimal(91),
    ...existingOverride,
  };
  const tx = {
    platform: {
      findUnique: mock(async () => ({
        ownerUserId: 'new-owner',
        isActive: true,
        owner: { isActive: true, isPurged: false },
      })),
    },
    transaction: {
      findFirst: mock(async () => existing),
      updateMany: mock(async () => ({ count: claim })),
      create: mock(async () => ({})),
    },
    wallet: {
      upsert: mock(async () => ({})),
      update: mock(async ({ data }: any) => ({
        balance: data.balance.increment,
        lockedBalance: new Prisma.Decimal(0),
      })),
    },
    balanceLog: { create: mock(async () => ({})) },
  };
  const prisma = { $transaction: mock(async (fn: any) => fn(tx)) };
  const bus = new PlatformEventsService();
  const service = new PlatformSyncPersistenceService(
    prisma as never,
    {} as never,
    bus,
    {} as never,
  );
  const persist = (row: unknown) =>
    (service as any).persist(
      { id: 'platform', tag: 'ATLAS', ownerUserId: 'new-owner' },
      row,
      'atlas',
    );
  return { persist, tx, bus };
}

describe('Shared sync persistence', () => {
  test('preserves original wallet after transfer and commits wallet delta with status', async () => {
    const { persist, tx } = fixture();
    await persist({
      id: 'gateway',
      status: 'paid',
      amount: 100,
      liquid_amount: 91,
    });
    expect((tx.wallet.update.mock.calls as any)[0][0]).toMatchObject({
      where: { userId: 'original-owner' },
    });
    expect(
      (
        tx.wallet.update.mock.calls as any
      )[0][0].data.balance.increment.toNumber(),
    ).toBe(100);
  });
  test('losing status claim cannot publish or credit', async () => {
    const { persist, tx, bus } = fixture(0);
    const received: unknown[] = [];
    const subscription = bus
      .stream('ATLAS')
      .subscribe((event) => received.push(event));
    expect(await persist({ id: 'gateway', status: 'paid', amount: 100 })).toBe(
      false,
    );
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(received).toEqual([]);
    subscription.unsubscribe();
  });
  test('cannot update another platform even when gateway ids match', async () => {
    const { persist, tx } = fixture(1, { description: '[TENANT:OTHER]' });
    expect(await persist({ id: 'gateway', status: 'paid', amount: 100 })).toBe(
      false,
    );
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });
  test('malformed amounts skip only bad provider row', async () => {
    const { persist, tx } = fixture();
    expect(
      await persist({ id: 'gateway', status: 'paid', amount: 'invalid' }),
    ).toBe(false);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });
  test('unknown provider status cannot regress settled funds', async () => {
    const { persist, tx } = fixture(1, { status: 'COMPLETED' });
    expect(
      await persist({
        id: 'gateway',
        status: 'new_provider_state',
        amount: 100,
      }),
    ).toBe(false);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
  test('pending provider status cannot regress completed payment', async () => {
    const { persist, tx } = fixture(1, { status: 'COMPLETED' });
    expect(
      await persist({ id: 'gateway', status: 'pending', amount: 100 }),
    ).toBe(false);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });
  test('canonical settlement preserves stored fees and credits stored net', async () => {
    const { persist, tx } = fixture(1, { id: 'a'.repeat(64) });
    expect(
      await persist({
        id: 'gateway',
        status: 'paid',
        amount: 100,
        liquid_amount: 99,
      }),
    ).toBe(true);
    expect((tx.transaction.updateMany.mock.calls as any)[0][0].data).toEqual({
      status: 'COMPLETED',
      previousStatus: 'PENDING',
    });
    expect(
      (
        tx.wallet.update.mock.calls as any
      )[0][0].data.balance.increment.toNumber(),
    ).toBe(91);
  });
  test('canonical settlement rejects provider gross mismatch', async () => {
    const { persist, tx } = fixture(1, { id: 'a'.repeat(64) });
    expect(await persist({ id: 'gateway', status: 'paid', amount: 101 })).toBe(
      false,
    );
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
  test('refund debits stored canonical net once', async () => {
    const { persist, tx } = fixture(1, {
      id: 'a'.repeat(64),
      status: 'COMPLETED',
    });
    expect(
      await persist({
        id: 'gateway',
        status: 'refunded',
        amount: 100,
        liquid_amount: 0,
      }),
    ).toBe(true);
    expect(
      (
        tx.wallet.update.mock.calls as any
      )[0][0].data.balance.increment.toNumber(),
    ).toBe(-91);
  });
  test('direct legacy polling coalesces same-platform work', async () => {
    const service = new PlatformSyncPersistenceService(
      {} as never,
      {} as never,
      new PlatformEventsService(),
      {} as never,
    );
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const execute = mock(() => pending);
    (service as any).executePoll = execute;
    const first = service.poll('ATLAS'),
      second = service.poll('ATLAS');
    expect(first).toBe(second);
    expect(execute).toHaveBeenCalledTimes(1);
    complete();
    await first;
    await service.poll('ATLAS');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
