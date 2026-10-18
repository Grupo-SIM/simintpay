import { InternalAreaflixFinanceService } from '../unified-platform/finance/legacy-areaflix-finance.service';
import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { PlatformCorporateController } from './platform-corporate.controller';
import { expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformLinkClaim } from './platform-link-claim';
function fixture() {
  let logged = false;
  const wallet = (userId: string) => ({ id: userId, userId, balance: new Prisma.Decimal(100), lockedBalance: new Prisma.Decimal(5), version: 0 });
  const p: any = {
    platform: { findUnique: async () => ({ id: 'p', ownerUserId: 'owner', isActive: true, owner: { isActive: true } }), count: mock(async () => 1) },
    paymentLink: { findMany: mock(async () => [{ id: 'link' }]), updateMany: mock(async () => ({ count: 1 })) },
    subscriptionLink: { findMany: async () => [], updateMany: mock(async () => ({ count: 0 })) },
    subscriptionLinkOrder: { updateMany: mock() }, transaction: { updateMany: mock() },
    platformIntegration: { findUnique: mock(async () => ({ url: 'source' })) },
    user: { findUnique: async () => ({ id: 'source', email: 'source@example.com', isActive: true, wallet: wallet('source') }) },
    wallet: { upsert: async () => wallet('owner'), updateMany: mock(async () => ({ count: 1 })) },
    balanceLog: { findFirst: mock(async () => logged ? { id: 'prior' } : null), create: mock(async () => { logged = true; return {}; }) },
    $transaction: async (f: any) => f(p),
  };
  return { p, service: new PlatformLinkClaim(p) };
}
test('claim changes future links and never rewrites settled ledger or historical orders', async () => {
  const { p, service } = fixture();
  expect(await service.claim('AREAFLIX', 'owner', { paymentLinkIds: ['link'] })).toMatchObject({ claimed: true, transferred: { paymentLinks: 1, transactions: 0, orders: 0 } });
  expect(p.transaction.updateMany).not.toHaveBeenCalled();
  expect(p.subscriptionLinkOrder.updateMany).not.toHaveBeenCalled();
  expect(p.paymentLink.updateMany.mock.calls[0][0].where.plataformas).toEqual({ has: 'AREAFLIX' });
});
test('unattributed and foreign links block claim before mutation', async () => {
  const { p, service } = fixture();
  p.paymentLink.findMany.mockImplementation(async () => []);
  await expect(service.claim('AREAFLIX', 'owner', { paymentLinkIds: ['foreign'] })).rejects.toThrow();
  expect(p.paymentLink.updateMany).not.toHaveBeenCalled();
});
test('retroactive transfer credits once and honors historical transfer logs', async () => {
  const { p, service } = fixture();
  expect((await service.claim('AREAFLIX', 'owner', { paymentLinkIds: ['link'], retroactiveAmountCents: 1200 })).retroactiveTransferred).toBe(12);
  expect((await service.claim('AREAFLIX', 'owner', { paymentLinkIds: ['link'], retroactiveAmountCents: 1200 })).retroactiveTransferred).toBe(0);
  expect(p.wallet.updateMany).toHaveBeenCalledTimes(2);
  expect(p.balanceLog.create).toHaveBeenCalledTimes(2);
});
test('missing explicit source and shared source wallet block transfer', async () => {
  for (const mode of ['missing', 'shared']) {
    const { p, service } = fixture();
    if (mode === 'missing') p.platformIntegration.findUnique.mockImplementation(async () => null);
    else p.platform.count.mockImplementation(async () => 2);
    await expect(service.claim('AREAFLIX', 'owner', { paymentLinkIds: ['link'], retroactiveAmountCents: 1200 })).rejects.toThrow();
    expect(p.wallet.updateMany).not.toHaveBeenCalled();
  }
});
test('claim rejects stale owner, insufficient available balance, fractional cents and source override', async () => {
  for (const [target, body] of [['foreign', {}], ['owner', { retroactiveAmountCents: 10000 }], ['owner', { retroactiveAmountCents: 1.5 }], ['owner', { retroactiveAmountCents: 100, serviceAccountEmail: 'foreign@example.com' }]] as const) {
    const { p, service } = fixture();
    await expect(service.claim('AREAFLIX', target, { paymentLinkIds: ['link'], ...body })).rejects.toThrow();
    expect(p.wallet.updateMany).not.toHaveBeenCalled();
  }
});

test('AreaFlix claim alias reais equals canonical cents with actual shared transfer and audit', async () => {
  const old = fixture(), current = fixture();
  old.p.user.findMany = async () => [{ id: 'owner' }];
  const legacy = new InternalAreaflixFinanceService(old.p, new PlatformFinanceService(old.p));
  const canonical = new PlatformCorporateController({} as any, current.p);
  const before = await legacy.claimLinks({ cpf: '12345678901', paymentLinkIds: ['link'], retroactiveAmount: 12.34 });
  const after = await canonical.claimLinks({ platformContext: { id: 'p', tag: 'AREAFLIX', ownerUserId: 'owner', acquirer: 'DOM' } }, { paymentLinkIds: ['link'], retroactiveAmountCents: 1234 });
  const { retroactiveTransferred, ...legacyResult } = before as any;
  expect(after).toEqual({ ...legacyResult, unit: 'cents', retroactiveTransferredCents: Math.round(retroactiveTransferred * 100) });
  expect(old.p.wallet.updateMany.mock.calls).toEqual(current.p.wallet.updateMany.mock.calls);
  expect(old.p.balanceLog.create.mock.calls).toEqual(current.p.balanceLog.create.mock.calls);
  expect(after.retroactiveTransferredCents).toBe(1234);
});
