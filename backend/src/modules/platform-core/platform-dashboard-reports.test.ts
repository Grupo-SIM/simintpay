import { beforeAll, expect, mock, test } from 'bun:test';
import { AtlasDashboardService } from '../atlas/services/atlas-dashboard.service';
import { RevalidaDashboardService } from '../revalida/services/revalida-dashboard.service';
import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { initializePlatformTaxasCache } from '../platform-taxas/platform-taxas.store';
beforeAll(async () => initializePlatformTaxasCache({ platformTaxaOverride: { findMany: async () => [] } } as any));
function fixture() {
  const now = new Date();
  const prisma: any = {
    platform: { findFirst: mock(async () => ({ ownerUserId: 'shared-owner' })) },
    wallet: { findUnique: async () => ({ balance: 100, lockedBalance: 5 }) },
    transaction: { findMany: mock(async () => [{ id: 'tx', amount: 10.29, netAmount: 10, status: 'COMPLETED', createdAt: now, customerName: 'Buyer', paymentMethod: 'PIX', installments: 1 }]), count: mock(async () => 1), aggregate: mock(async () => ({ _sum: { netAmount: 10 }, _count: { id: 1 } })) },
    withdrawRequest: { findMany: mock(async () => [{ id: 'w', createdAt: now, amount: 5, grossAmount: 7, fee: 2 }]), count: mock(async () => 1), aggregate: mock(async () => ({ _sum: { amount: 5 } })) },
  };
  return { prisma, finance: new PlatformFinanceService(prisma) };
}
for (const [tag, Service] of [['ATLAS', AtlasDashboardService], ['REVALIDA', RevalidaDashboardService]] as const) {
  test(`${tag} dashboard alias and canonical preserve projection and monetary conversion`, async () => {
    const { prisma, finance } = fixture();
    const alias = new Service(prisma);
    const context = { id: 'p', tag, ownerUserId: 'shared-owner', acquirer: 'DOM' as const };
    const sales = await alias.getSales(1, 20);
    const canonical = await finance.dashboard(context, 'sales') as any;
    expect(canonical.data[0].amountCents).toBe(1029);
    expect(canonical.data[0].netAmountCents).toBe(Math.round(sales.data[0].valor_liquido * 100));
    const summary = await alias.getSummary();
    const result = await finance.dashboard(context, 'summary') as any;
    expect(result.balanceCents).toBe(Math.round(summary.total_balance * 100));
    const stats = await alias.getDashboardData();
    const statsCanonical = await finance.dashboard(context, 'stats') as any;
    expect(statsCanonical.profit.total).toBe(Math.round(stats.profit.total * 100));
    expect(statsCanonical.profit.today.total).toBe(Math.round(stats.profit.today.total * 100));
    expect(statsCanonical.profit.charts.last30Days).toEqual(stats.profit.charts.last30Days.map(row => ({ ...row, value: Math.round(row.value * 100) })));
    expect(statsCanonical.withdrawalCounts).toEqual(stats.withdrawals);
    expect(statsCanonical.refunds).toEqual({ count: stats.estornos.quantidade, netAmountCents: Math.round(stats.estornos.valorLiquido * 100) });
    const withdrawals = await alias.getWithdrawals(1, 20);
    const withdrawalsCanonical = await finance.dashboard(context, 'withdrawals') as any;
    expect(withdrawalsCanonical.meta).toEqual(withdrawals.meta);
    expect(withdrawalsCanonical.data).toEqual(withdrawals.data.map(({ amount, grossAmount, fee, ...row }) => ({ ...row, amountCents: Math.round(amount * 100), grossAmountCents: Math.round(grossAmount * 100), feeCents: Math.round(fee * 100) })));
    for (const fn of [prisma.transaction.findMany, prisma.transaction.count, prisma.transaction.aggregate]) {
      for (const [query] of fn.mock.calls as any[]) expect(query.where.description).toEqual({ contains: `[TENANT:${tag}]`, mode: 'insensitive' });
    }
    for (const fn of [prisma.withdrawRequest.findMany, prisma.withdrawRequest.count, prisma.withdrawRequest.aggregate]) {
      for (const [query] of fn.mock.calls as any[]) expect(query.where.platform).toBe(tag.toLowerCase());
    }
  });
}
test('dashboard refuses context invalidated by ownership transfer', async () => {
  const { finance, prisma } = fixture();
  await expect(finance.dashboard({ id: 'p', tag: 'ATLAS', ownerUserId: 'old-owner', acquirer: 'DOM' }, 'summary')).rejects.toThrow('Dono da plataforma mudou');
  expect(prisma.transaction.aggregate).not.toHaveBeenCalled();
});
