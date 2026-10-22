import { expect, mock, test } from 'bun:test';
import { IntegrationFinanceService } from './integration-finance.service';
function fixture() {
  const merchant = { id: 'm', userId: 'seller', integrationKey: 'legacy', user: { isActive: true, wallet: {} } };
  const queries: any[] = [];
  const p: any = {
    platformIntegration: { findMany: async () => [{ url: 'legacy', platform: { id: 'p', tag: 'SHOP', acquirer: 'DOM' } }] },
    integrationMerchant: { findUnique: async () => merchant, findMany: async () => [merchant] },
    withdrawRequest: { count: async () => 0, findMany: async (q: any) => { queries.push(q); return []; }, findFirst: async (q: any) => { queries.push(q); return null; } },
    transaction: { findFirst: async () => null, update: mock(async () => ({})) },
    wallet: { update: mock(async () => ({})) }, integrationWebhookDelivery: { upsert: mock(async () => ({})) },
  };
  return { merchant, queries, p, service: new IntegrationFinanceService(p) };
}
test('merchant withdrawal list and detail require explicit product or registered legacy namespace', async () => {
  const { service, queries } = fixture();
  await service.listWithdrawals('legacy', 'external');
  await expect(service.getWithdrawal('legacy', 'external', 'foreign')).rejects.toThrow('não encontrado');
  for (const q of queries) expect(q.where).toMatchObject({ userId: 'seller', OR: [{ platform: 'legacy' }, { platform: 'shop', integrationWebhookDeliveries: { some: { merchantId: 'm' } } }] });
});
test('status outbox sweeper excludes other products in shared user wallet', async () => {
  const { service, queries } = fixture(); await service.enqueueCurrentStatuses();
  expect(queries[0].where).toEqual({ userId: 'seller', platform: { in: ['legacy', 'shop'] } });
});
test('merchant reconciliation preserves all historical wallets and reports conflicts', async () => {
  const { service, p } = fixture();
  const rows = [
    { userId: 'seller', description: '[TENANT:SHOP]' },
    { userId: 'previous-owner', description: '[TENANT:SHOP]' },
    { userId: 'seller', description: '[TENANT:OTHER]' },
    { userId: 'seller', description: '[TENANT:SHOP] [TENANT:OTHER]' },
    { userId: 'seller', description: 'untagged' },
  ];
  p.transaction.findFirst = async () => rows.shift();
  expect(await service.reconcilePayments('legacy', 'external', ['own', 'history', 'foreign', 'conflict', 'untagged'], false)).toEqual({ attributed: 0, creditedCents: 0, skipped: 1, conflicts: ['history', 'foreign', 'conflict', 'untagged'], dryRun: false });
  expect(p.transaction.update).not.toHaveBeenCalled(); expect(p.wallet.update).not.toHaveBeenCalled();
});
test('canonical and legacy merchant quote/list/detail/reconciliation preserve financial units and scope', async () => {
  const { PlatformMerchantsService } = await import('../platform-core/platform-merchants.service');
  const { PlatformFinanceService } = await import('../unified-platform/finance/platform-finance.service');
  const { service, p, merchant } = fixture();
  const context = { id: 'p', tag: 'SHOP', ownerUserId: 'owner', acquirer: 'DOM' as const };
  p.integrationMerchant.findUnique = async (q: any) => q.where.integrationKey_externalMerchantId?.integrationKey === 'platform:p' ? null : merchant;
  p.platformIntegration.findUnique = async () => ({ url: 'legacy' });
  const canonical = new PlatformMerchantsService(p, {} as any, new PlatformFinanceService(p));
  expect(await canonical.quote(context, 'external', 12000)).toEqual(service.quote(12000, 'SHOP'));
  const legacyList = await service.listWithdrawals('legacy', 'external', 2, 10);
  const list = await canonical.withdrawals(context, 'external', 2, 10);
  expect(list).toEqual({ unit: 'cents', data: legacyList.items, meta: { page: 2, limit: 10, total: legacyList.meta.totalItems, totalPages: legacyList.meta.totalPages } });
  const { Prisma } = await import('@prisma/client');
  p.withdrawRequest.findFirst = async () => ({ id: 'w', amount: new Prisma.Decimal('0.29'), grossAmount: new Prisma.Decimal('2.29'), fee: new Prisma.Decimal(2), status: 'PENDING', pixKey: 'key' });
  const { netAmountCents, ...old } = await service.getWithdrawal('legacy', 'external', 'w');
  expect(await canonical.withdrawal(context, 'external', 'w')).toEqual({ unit: 'cents', ...old, amountCents: netAmountCents });
  expect(netAmountCents).toBe(29);
  p.transaction.findFirst = async () => ({ userId: 'seller', description: '[TENANT:SHOP]' });
  expect(await canonical.reconcile(context, 'external', ['payment'], true)).toEqual(await service.reconcilePayments('legacy', 'external', ['payment'], true));
});

test('merchant summary compares pooled wallet cents, product processing and decimal fee rate', async () => {
  const { PlatformMerchantsService } = await import('../platform-core/platform-merchants.service');
  const { PlatformFinanceService } = await import('../unified-platform/finance/platform-finance.service');
  const { Prisma } = await import('@prisma/client');
  const { service, p, merchant, queries } = fixture();
  const context = { id: 'p', tag: 'SHOP', ownerUserId: 'owner', acquirer: 'DOM' as const };
  (merchant.user as any).wallet = { balance: new Prisma.Decimal('12.34'), lockedBalance: new Prisma.Decimal('2.34') };
  p.wallet.findUnique = async () => merchant.user.wallet;
  p.platform = { count: async () => 2 };
  p.withdrawRequest.aggregate = async (q: any) => { queries.push(q); return { _count: { id: 1 }, _sum: { grossAmount: new Prisma.Decimal(2) } }; };
  p.integrationMerchant.findUnique = async (q: any) => q.where.integrationKey_externalMerchantId?.integrationKey === 'platform:p' ? null : merchant;
  p.platformIntegration.findUnique = async () => ({ url: 'legacy' });
  const canonical = new PlatformMerchantsService(p, {} as any, new PlatformFinanceService(p));
  const before = await service.summary('legacy', 'external');
  const after = await canonical.summary(context, 'external');
  expect(after.availableBalanceCents).toBe(before.availableBalanceCents);
  expect(after.processingCount).toBe(before.processingCount);
  expect(after.processingGrossCents).toBe(before.processingGrossCents);
  expect(after.canRequest).toBe(before.canRequest);
  expect(after.feePolicy).toEqual({ fixedCents: before.feePolicy.fixedCents, rate: before.feePolicy.percentBasisPoints / 10000 });
  expect(queries[1].where.OR).toEqual([{ platform: 'legacy' }, { platform: 'shop', integrationWebhookDeliveries: { some: { merchantId: 'm' } } }]);
});
