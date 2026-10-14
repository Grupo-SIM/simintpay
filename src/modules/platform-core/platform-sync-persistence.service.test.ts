import { describe, test, expect, mock } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformSyncPersistenceService } from './platform-sync-persistence.service';
import { PlatformEventsService } from './platform-events.service';

function fixture(claim = 1, existingOverride = {}) {
  const existing = { id: 'local', status: 'PENDING', userId: 'original-owner', acquirer: 'DOM', description: '[TENANT:ATLAS]', amount: new Prisma.Decimal(100), netAmount: new Prisma.Decimal(91), ...existingOverride };
  const tx = { platform: { findUnique: mock(async () => ({ ownerUserId: 'new-owner', isActive: true, owner: { isActive: true, isPurged: false } })) },
    transaction: { findFirst: mock(async () => existing), updateMany: mock(async () => ({ count: claim })), create: mock(async () => ({})) },
    wallet: { update: mock(async () => ({})) } };
  const prisma = { $transaction: mock(async (fn: any) => fn(tx)) };
  const bus = new PlatformEventsService();
  const service = new PlatformSyncPersistenceService(prisma as never, {} as never, bus, {} as never);
  const persist = (row: unknown) => (service as any).persist({ id: 'platform', tag: 'ATLAS', ownerUserId: 'new-owner' }, row, 'atlas');
  return { persist, tx, bus };
}

describe('Shared sync persistence', () => {
  test('preserves original wallet after transfer and commits wallet delta with status', async () => {
    const { persist, tx } = fixture();
    await persist({ id: 'gateway', status: 'paid', amount: 100, liquid_amount: 91 });
    expect((tx.wallet.update.mock.calls as any)[0][0]).toMatchObject({ where: { userId: 'original-owner' } });
    expect((tx.wallet.update.mock.calls as any)[0][0].data.balance.increment.toNumber()).toBe(100);
  });
  test('losing status claim cannot publish or credit', async () => {
    const { persist, tx, bus } = fixture(0);
    const received: unknown[] = []; const subscription = bus.stream('ATLAS').subscribe(event => received.push(event));
    expect(await persist({ id: 'gateway', status: 'paid', amount: 100 })).toBe(false);
    expect(tx.wallet.update).not.toHaveBeenCalled(); expect(received).toEqual([]); subscription.unsubscribe();
  });
  test('cannot update another platform even when gateway ids match', async () => {
    const { persist, tx } = fixture(1, { description: '[TENANT:OTHER]' });
    expect(await persist({ id: 'gateway', status: 'paid', amount: 100 })).toBe(false);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });
});
