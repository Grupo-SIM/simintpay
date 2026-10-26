import { describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PlatformMaintenanceService } from './platform-maintenance.service';

const context = { id: 'platform', tag: 'SHOP', ownerUserId: 'owner', acquirer: 'DOM' as const };
function fixture() {
  const platforms = [{ ...context, isActive: true, updatedAt: new Date(), owner: { isActive: true, isPurged: false } }];
  const tx = {
    platform: { findMany: mock(async () => platforms), update: mock(async () => ({})) },
    wallet: { findUnique: mock(async () => ({ id: 'wallet', version: 4, balance: new Prisma.Decimal(100), lockedBalance: new Prisma.Decimal(10) })), updateMany: mock(async () => ({ count: 1 })) },
    balanceLog: { create: mock(async () => ({})) },
  };
  const prisma = { $transaction: async (cb: any) => cb(tx) };
  return { service: new PlatformMaintenanceService(prisma as unknown as PrismaService), tx, platforms };
}
describe('Platform maintenance', () => {
  test('zeroes exclusive wallet with audit and preserves all history', async () => {
    const { service, tx } = fixture();
    expect(await service.run(context, 'zero-wallet', { reason: 'Liquidação manual' })).toMatchObject({ changed: true, before: { balanceCents: 10000 }, after: { balanceCents: 0, lockedBalanceCents: 0 } });
    expect(tx.balanceLog.create).toHaveBeenCalledTimes(1);
    expect(tx.wallet.updateMany.mock.calls[0][0].where).toEqual({ id: 'wallet', version: 4 });
  });
  test('legacy baseline delegates to guarded core and appends ledger only', async () => {
    const { service, tx, platforms } = fixture();
    platforms.push({ ...platforms[0], tag: 'OTHER' });
    await expect(service.baseline('owner', 'SHOP', 5, 'BASELINE', 'Ajuste')).rejects.toThrow('Carteira sem vínculo exclusivo');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
  test('shared wallet blocked before mutation', async () => {
    const { service, tx, platforms } = fixture(); platforms.push({ ...platforms[0], tag: 'OTHER' });
    await expect(service.run(context, 'zero-wallet', { reason: 'Reset' })).rejects.toThrow('Carteira sem vínculo exclusivo');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
  test('ownership transfer blocks stale request', async () => {
    const { service, tx, platforms } = fixture(); platforms[0].id = 'other-platform';
    await expect(service.run(context, 'zero-wallet', { reason: 'Reset' })).rejects.toThrow('alterado/inativo');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
  test('wallet optimistic conflict aborts before audit', async () => {
    const { service, tx } = fixture(); tx.wallet.updateMany.mockImplementation(async () => ({ count: 0 }));
    await expect(service.run(context, 'zero-wallet', { reason: 'Reset' })).rejects.toThrow('Carteira alterada');
    expect(tx.balanceLog.create).not.toHaveBeenCalled();
  });
  test('canonical cents strict; context cannot be replaced by body', async () => {
    const { service, tx } = fixture();
    for (const body of [{ balanceCents: 2.5, reason: 'Fix' }, { balanceCents: 5, userId: 'other', reason: 'Fix' }]) await expect(service.run(context, 'set-balance', body)).rejects.toThrow();
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });
});
