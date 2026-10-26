import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { InternalBosqueFinanceService } from '../../unified-platform/finance/legacy-bosque-finance.service';
import { InternalBosqueFinanceController } from '../../../presentation/controllers/internal-bosque-finance.controller';
import { PlatformFinanceService } from '../../unified-platform/finance/platform-finance.service';
import { PlatformMaintenanceService } from '../../unified-platform/finance/platform-maintenance.service';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';

beforeEach(async () => initializePlatformTaxasCache({ platformTaxaOverride: { findMany: async () => [{ tag: 'BOSQUE', key: 'TAXA_SERVICO', value: 0 }] } } as any));
afterEach(async () => initializePlatformTaxasCache({ platformTaxaOverride: { findMany: async () => [] } } as any));
function fixture() {
  const context = { id: 'p', tag: 'BOSQUE', ownerUserId: 'owner', acquirer: 'DOM' as const };
  const state = { earned: 100, withdrawn: 0, wallet: 100, locked: 10, inTransaction: false, concurrentEarned: undefined as number | undefined, concurrentWallet: undefined as number | undefined };
  const platform = { ...context, updatedAt: new Date(0), isActive: true, owner: { isActive: true, isPurged: false } };
  const p: any = {
    platform: { findMany: async () => [platform], update: async () => platform },
    user: { findMany: async () => [{ id: 'owner' }] },
    wallet: { findUnique: async () => ({ id: 'wallet', version: 4, balance: new Prisma.Decimal(state.wallet), lockedBalance: new Prisma.Decimal(state.locked) }), updateMany: mock(async () => ({ count: 1 })) },
    transaction: { aggregate: async () => ({ _sum: { netAmount: state.earned } }), count: async () => 0 },
    withdrawRequest: { findMany: async () => [{ grossAmount: state.withdrawn }], create: mock(async ({ data }: any) => { state.withdrawn += data.grossAmount; return { id: 'baseline', ...data }; }) },
    balanceLog: { create: mock(async () => ({})) },
    $transaction: async (fn: any, options: any) => {
      expect(options.isolationLevel).toBe('Serializable');
      if (state.concurrentEarned !== undefined) state.earned = state.concurrentEarned;
      if (state.concurrentWallet !== undefined) state.wallet = state.concurrentWallet;
      return fn(p);
    },
  };
  const finance = new PlatformFinanceService(p);
  return { state, p, context, alias: new InternalBosqueFinanceController(new InternalBosqueFinanceService(p, finance)), core: new PlatformMaintenanceService(p) };
}
test('Bosque baseline alias and canonical cents append same accounting deduction without moving cash wallet', async () => {
  const a = fixture(), b = fixture();
  const old = await a.alias.zerarDisponivel({ userId: 'owner', valor: 30, reason: 'Liquidação externa' });
  const current = await b.core.run(b.context, 'baseline', { amountCents: 3000, reason: 'Liquidação externa' });
  expect(old).toMatchObject({ success: true, antes: 100, abatido: 30, depois: 70 });
  expect(current).toMatchObject({ beforeAvailableCents: 10000, appliedCents: 3000, afterAvailableCents: 7000 });
  expect(a.p.withdrawRequest.create.mock.calls).toEqual(b.p.withdrawRequest.create.mock.calls);
  expect(a.p.balanceLog.create.mock.calls).toEqual(b.p.balanceLog.create.mock.calls);
  expect(a.p.wallet.updateMany).not.toHaveBeenCalled(); expect(b.p.wallet.updateMany).not.toHaveBeenCalled();
});
test('Bosque baseline recalculates inside transaction and repeated request cannot over-deduct', async () => {
  const f = fixture(); f.state.concurrentEarned = 40;
  expect(await f.alias.zerarDisponivel({ userId: 'owner', valor: 100 })).toMatchObject({ antes: 40, abatido: 40, depois: 0 });
  expect(await f.alias.zerarDisponivel({ userId: 'owner', valor: 100 })).toMatchObject({ antes: 0, depois: 0 });
  expect(f.p.withdrawRequest.create).toHaveBeenCalledTimes(1);
  expect(f.state.withdrawn).toBe(40);
});
test('Bosque baseline consumed before transaction creates no withdrawal or audit', async () => {
  const f = fixture(); f.state.concurrentEarned = 0;
  expect(await f.alias.zerarDisponivel({ userId: 'owner' })).toMatchObject({ antes: 0, depois: 0 });
  expect(f.p.withdrawRequest.create).not.toHaveBeenCalled(); expect(f.p.balanceLog.create).not.toHaveBeenCalled();
});
test('Bosque fixed-balance alias and canonical cents persist same correction and return transactional snapshots', async () => {
  const a = fixture(), b = fixture();
  const old = await a.alias.fixBalance({ userId: 'owner', balance: 50, lockedBalance: 2, reason: 'Correção' });
  const current = await b.core.run(b.context, 'set-balance', { balanceCents: 5000, lockedBalanceCents: 200, reason: 'Correção' });
  expect(a.p.wallet.updateMany.mock.calls).toEqual(b.p.wallet.updateMany.mock.calls);
  expect(old).toMatchObject({ before: { balance: 100, lockedBalance: 10 }, after: { balance: 50, lockedBalance: 2 } });
  expect(current.after).toEqual({ balanceCents: 5000, lockedBalanceCents: 200 });
});
test('Bosque delta uses transactional wallet rather than stale pre-read and preserves locked balance', async () => {
  const a = fixture(), b = fixture(); a.state.concurrentWallet = 200; b.state.concurrentWallet = 200;
  const old = await a.alias.fixBalance({ userId: 'owner', delta: 5.25, reason: 'Ajuste' });
  const current = await b.core.run(b.context, 'adjust-balance', { deltaCents: 525, reason: 'Ajuste' });
  expect(old).toMatchObject({ before: { balance: 200 }, after: { balance: 205.25, lockedBalance: 10 } });
  expect(current.after).toEqual({ balanceCents: 20525, lockedBalanceCents: 1000 });
  expect(a.p.wallet.updateMany.mock.calls).toEqual(b.p.wallet.updateMany.mock.calls);
});
test('legacy negative correction floor remains confined to alias; canonical rejects negative resulting wallet', async () => {
  const a = fixture(), b = fixture();
  expect(await a.alias.fixBalance({ userId: 'owner', delta: -200 })).toMatchObject({ after: { balance: 0 } });
  await expect(b.core.run(b.context, 'adjust-balance', { deltaCents: -20000, reason: 'Ajuste' })).rejects.toThrow('Saldo não pode ser negativo');
  expect(b.p.wallet.updateMany).not.toHaveBeenCalled();
});
