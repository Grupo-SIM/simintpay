import { expect, test } from 'bun:test';
import { platformMerchant } from './platform-merchant-lookup';
const context = {
  id: 'p',
  tag: 'SHOP',
  ownerUserId: 'owner',
  acquirer: 'DOM' as const,
};
function fixture() {
  const merchant = {
    id: 'm',
    userId: 'seller',
    integrationKey: 'old-key',
    user: { isActive: true },
  };
  const p: any = {
    integrationMerchant: {
      findUnique: async () => null,
      findMany: async () => [merchant],
    },
    platformIntegration: {
      findUnique: async () => ({ url: 'old-key' }),
      findMany: async () => [{ url: 'old-key', platform: context }],
    },
  };
  return { merchant, p };
}
test('canonical merchant can reuse existing explicit legacy binding without creating a duplicate', async () => {
  const { merchant, p } = fixture();
  expect(await platformMerchant(p, context, 'external')).toBe(merchant);
});
test('missing and ambiguous legacy merchant bindings never choose an arbitrary association', async () => {
  const { merchant, p } = fixture();
  p.integrationMerchant.findMany = async () => [
    merchant,
    { ...merchant, id: 'other' },
  ];
  await expect(platformMerchant(p, context, 'external')).rejects.toThrow(
    'ambiguidade',
  );
  p.platformIntegration.findUnique = async () => null;
  await expect(platformMerchant(p, context, 'external')).rejects.toThrow(
    'não associado',
  );
});
test('legacy namespace shared by two products is rejected', async () => {
  const { p } = fixture();
  p.platformIntegration.findMany = async () => [
    { url: 'old-key', platform: context },
    { url: 'old-key', platform: { ...context, id: 'other' } },
  ];
  await expect(platformMerchant(p, context, 'external')).rejects.toMatchObject({
    response: { code: 'PLATFORM_CAPABILITY_UNAVAILABLE' },
  });
});

test('merchant payment status alias and canonical preserve scoped historical financial owner', async () => {
  const { IntegrationPaymentService } =
    await import('../integrations/integration-payment.service');
  const { IntegrationFinanceService } =
    await import('../integrations/integration-finance.service');
  const { PlatformMerchantsService } =
    await import('./platform-merchants.service');
  const { PlatformFinanceService } =
    await import('../unified-platform/finance/platform-finance.service');
  const { initializePlatformIntegrationsCache } =
    await import('../platform-integrations/platform-integrations.store');
  const { Prisma } = await import('@prisma/client');
  const { p, merchant } = fixture();
  const payment = {
    id: 'local',
    userId: 'seller',
    amount: new Prisma.Decimal('12.34'),
    domPaymentId: 'remote',
    externalPaymentId: 'remote',
    description: '[TENANT:SHOP]',
    platformTag: 'SHOP',
    acquirer: 'DOM',
    status: 'COMPLETED',
  } as any;
  const { matches } = await import('./tests/platform-query-fixture');
  (merchant.user as any).wallet = {};
  p.platform = {
    findUnique: async () => ({
      ...context,
      isActive: true,
      owner: { isActive: true },
    }),
  };
  p.transaction = {
    findFirst: async ({ where }: any) =>
      matches(payment, where) ? payment : null,
  };
  p.integrationMerchant.findUnique = async (q: any) =>
    q.where.integrationKey_externalMerchantId?.integrationKey === 'platform:p'
      ? null
      : merchant;
  const reconcile = {
    reconcilePayment: async (id: string, userId: string) => ({
      paymentId: id,
      status: 'COMPLETED',
      userId,
    }),
  };
  await initializePlatformIntegrationsCache({
    platformIntegration: {
      findMany: async () => [
        { platform: { tag: 'SHOP' }, key: 'DOM_TOKEN', url: 'mock-only' },
      ],
    },
  } as any);
  try {
    const legacy = new IntegrationPaymentService(
      p,
      new IntegrationFinanceService(p),
      reconcile as any,
    );
    const canonical = new PlatformMerchantsService(
      p,
      {} as any,
      new PlatformFinanceService(p),
    );
    const old = await legacy.status('old-key', 'external', 'remote');
    const current = await canonical.payment(context, 'external', 'remote');
    expect(current).toMatchObject({
      transactionId: 'local',
      paymentId: old.paymentId,
      status: old.status,
      amountCents: 1234,
    });
    expect(payment.userId).toBe('seller');
    payment.platformTag = 'OTHER';
    expect(await legacy.status('old-key', 'external', 'remote')).toEqual({
      paymentId: 'remote',
      status: 'NOT_FOUND',
    });
    await expect(
      canonical.payment(context, 'external', 'remote'),
    ).rejects.toThrow('Pagamento não encontrado');
  } finally {
    await initializePlatformIntegrationsCache({
      platformIntegration: { findMany: async () => [] },
    } as any);
  }
}, 30000);
