import { expect, test } from 'bun:test';
import { PlatformOwnerMirror } from './platform-owner-mirror';
import { AtlasDashboardController } from '../atlas/controllers/atlas-dashboard.controller';
import { RevalidaDashboardController } from '../revalida/controllers/revalida-dashboard.controller';
function fixture(tag: string) {
  const writes: unknown[] = [];
  const context = { id: 'p', tag, ownerUserId: 'owner', acquirer: 'DOM' as const };
  const p: any = {
    platform: { findFirst: async () => ({ ...context }) },
    user: { findUnique: async () => ({ id: 'owner', name: 'Owner', cpf: '123' }) },
    wallet: { findUnique: async () => ({ balance: 12.34 }) },
    externalPlatformUser: { upsert: async (q: any) => { writes.push(q); return { id: 'external' }; } },
    externalPlatformWallet: { upsert: async (q: any) => { writes.push(q); return {}; } },
    $transaction: async (f: any) => f(p),
  };
  return { p, context, writes };
}
for (const [tag, Controller] of [['ATLAS', AtlasDashboardController], ['REVALIDA', RevalidaDashboardController]] as const) {
  test(`${tag} owner-mirror alias preserves canonical projection and writes`, async () => {
    const a = fixture(tag), b = fixture(tag);
    const result = await new Controller({} as any, {} as any, a.p).syncExternalUser();
    expect(result).toEqual(await new PlatformOwnerMirror(b.p).sync(tag, b.context));
    expect(a.writes.map((q: any) => ({ ...q, update: { ...q.update, updatedAt: undefined } })))
      .toEqual(b.writes.map((q: any) => ({ ...q, update: { ...q.update, updatedAt: undefined } })));
    expect(result).toMatchObject({ balance: 12.34, platform: tag.toLowerCase(), userId: 'owner' });
  });
}
test('missing registered owner creates no mirror', async () => {
  const { p, writes } = fixture('ATLAS');
  p.platform.findFirst = async () => null;
  expect(await new PlatformOwnerMirror(p).sync('ATLAS')).toMatchObject({ success: false });
  expect(writes).toHaveLength(0);
});
test('stale owner cannot overwrite mirrored balance', async () => {
  const { p, writes, context } = fixture('ATLAS');
  await expect(new PlatformOwnerMirror(p).sync('ATLAS', { ...context, ownerUserId: 'old' })).rejects.toThrow('Contexto da plataforma mudou');
  expect(writes).toHaveLength(0);
});
test('canonical owner mirror converts only response currency and rejects unsupported product', async () => {
  const { PlatformOperationsController } = await import('./platform-operations.controller');
  const { p, context } = fixture('ATLAS');
  const { PlatformFinanceService } = await import('../unified-platform/finance/platform-finance.service');
  const finance = new PlatformFinanceService(p);
  const controller = new PlatformOperationsController(finance, {} as any, {} as any, {} as any);
  expect(await controller.ownerMirror({ platformContext: context } as any)).toMatchObject({ balanceScope: 'owner-wallet', unit: 'cents', balanceCents: 1234 });
  await expect(controller.ownerMirror({ platformContext: { ...context, tag: 'GENERIC' } } as any)).rejects.toMatchObject({ response: { code: 'PLATFORM_CAPABILITY_UNAVAILABLE' } });
});
