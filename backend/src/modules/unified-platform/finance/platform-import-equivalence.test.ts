import { Prisma } from '@prisma/client';
import { initializePlatformRegistryCache } from '../../module.registry';
import { InternalEbookFinanceService } from './legacy-ebook-finance.service';
import { calculateSellerNetValue } from '../../../application/helpers/transaction-fee.helper';
import { beforeAll, afterEach, expect, mock, test } from 'bun:test';
import { PlatformSubscriptionCapabilitiesService } from '../../platform-core/platform-subscription-capabilities.service';
import { InternalPagatgFinanceService } from './legacy-pagatg-finance.service';
import { PlatformFinanceService } from './platform-finance.service';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';
beforeAll(async () =>
  initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as any),
);
function fixture() {
  const prisma: any = {
    platform: {
      findUnique: async () => ({
        isActive: true,
        ownerUserId: 'owner',
        acquirer: 'DOM',
        owner: { isActive: true },
      }),
    },
    user: {
      findUnique: async () => ({ isActive: true }),
      findMany: async () => [{ id: 'owner' }],
    },
    transaction: {
      findUnique: async () => null,
      create: mock(async ({ data }: any) => ({ id: 'entry', ...data })),
    },
    wallet: {
      upsert: mock(async () => ({})),
      update: mock(async ({ data }: any) => ({
        balance: data.balance.increment,
        lockedBalance: new Prisma.Decimal(0),
      })),
    },
    balanceLog: { create: mock(async () => ({})) },
    $transaction: async (f: any) => f(prisma),
  };
  const finance = new PlatformFinanceService(prisma);
  return {
    prisma,
    finance,
    alias: new InternalPagatgFinanceService(prisma, {} as any, finance),
  };
}
test('PAGATG alias reais and canonical cents produce equivalent ledger and credit', async () => {
  const old = fixture(),
    canonical = fixture();
  const alias = await old.alias.recordTransaction({
    cpf: '12345678901',
    domPaymentId: 'invoice',
    amount: 12.34,
    netAmount: 12,
    planDescription: 'Plano',
    paymentMethod: 'PIX',
  });
  const result = await canonical.finance.importEntry(
    { id: 'platform', tag: 'PAGATG', ownerUserId: 'owner', acquirer: 'DOM' },
    {
      referenceId: 'invoice',
      amountCents: 1234,
      netAmountCents: 1200,
      kind: 'payment',
      paymentMethod: 'PIX',
      description: 'Plano',
    },
  );
  expect(alias).toEqual(result);
  const a = old.prisma.transaction.create.mock.calls[0][0].data;
  const b = canonical.prisma.transaction.create.mock.calls[0][0].data;
  for (const key of [
    'userId',
    'domPaymentId',
    'status',
    'paymentMethod',
    'acquirer',
  ])
    expect(a[key]).toEqual(b[key]);
  for (const key of ['amount', 'netAmount', 'totalFee'])
    expect(a[key].toString()).toEqual(b[key].toString());
  expect(
    old.prisma.wallet.update.mock.calls[0][0].data.balance.increment.toString(),
  ).toEqual(
    canonical.prisma.wallet.update.mock.calls[0][0].data.balance.increment.toString(),
  );
});
test('plan mirror rejects global code owned by another product', async () => {
  const { prisma, finance } = fixture();
  prisma.plan = {
    findUnique: async () => ({ userId: 'owner', plataformas: ['OTHER'] }),
    update: mock(async () => ({})),
    create: mock(async () => ({})),
  };
  await expect(
    finance.mirrorPlan('PAGATG', 'owner', 'plan', {
      name: 'Plano',
      price: 10,
      type: 'MONTHLY',
    }),
  ).rejects.toThrow('Plano sem vínculo');
  expect(prisma.plan.update).not.toHaveBeenCalled();
});

test('existing Pagatg plan import equals legacy mirror without creating provider subscriptions', async () => {
  const old = fixture(),
    current = fixture();
  const context = {
    id: 'platform',
    tag: 'PAGATG',
    ownerUserId: 'owner',
    acquirer: 'DOM' as const,
  };
  for (const f of [old, current]) {
    f.prisma.platform.findUnique = async () => ({
      ...context,
      isActive: true,
      owner: { isActive: true },
    });
    f.prisma.plan = {
      findUnique: async () => null,
      create: mock(async ({ data }: any) => ({ id: 'plan', ...data })),
    };
  }
  const canonical = new PlatformSubscriptionCapabilitiesService(
    current.prisma,
    { resolve: async () => context } as any,
    { get: () => current.finance } as any,
  );
  const before = await old.alias.upsertPlan({
    cpf: '12345678901',
    code: 'existing',
    name: 'Plano',
    price: 12.34,
    type: 'MENSAL',
    domPlanId: 'provider',
  });
  const after = await canonical.importPlan(context, {
    code: 'existing',
    name: 'Plano',
    amountCents: 1234,
    type: 'MONTHLY',
    externalPlanId: 'provider',
  });
  expect(after).toEqual(before);
  const a = old.prisma.plan.create.mock.calls[0][0].data,
    b = current.prisma.plan.create.mock.calls[0][0].data;
  expect({ ...a, price: String(a.price) }).toEqual({
    ...b,
    price: String(b.price),
  });
  expect(b.plataformas).toEqual(['PAGATG']);
  expect(b.userId).toBe('owner');
  await expect(
    canonical.importPlan(
      { ...context, tag: 'OTHER' },
      { code: 'existing', name: 'Plano', amountCents: 1234, type: 'MONTHLY' },
    ),
  ).rejects.toThrow();
  current.prisma.platform.findUnique = async () => ({
    ...context,
    ownerUserId: 'transferred',
    isActive: true,
    owner: { isActive: true },
  });
  await expect(
    canonical.importPlan(context, {
      code: 'existing',
      name: 'Plano',
      amountCents: 1234,
      type: 'MONTHLY',
    }),
  ).rejects.toThrow('Contexto');
  expect(current.prisma.plan.create).toHaveBeenCalledTimes(1);
});

afterEach(async () =>
  initializePlatformRegistryCache({
    platform: { findMany: async () => [] },
  } as any),
);
for (const kind of ['pending', 'commission'] as const)
  test(`Ebook ${kind} import preserves ledger without crediting owner wallet`, async () => {
    await initializePlatformRegistryCache({
      platform: {
        findMany: async () => [{ tag: 'EBOOK', ownerUserId: 'owner' }],
      },
    } as any);
    const old = fixture(),
      current = fixture();
    const legacy = new InternalEbookFinanceService(
      old.prisma,
      {} as any,
      old.finance,
    );
    const amount = 12.34;
    const net =
      kind === 'pending'
        ? calculateSellerNetValue(amount, 1, 'EBOOK', 'pix')
        : amount;
    const before =
      kind === 'pending'
        ? await legacy.createPendingTransaction({
            orderNumber: 'order',
            amount,
            buyerName: 'Buyer',
            buyerEmail: 'buyer@example.com',
            buyerDocument: '123.456.789-01',
          })
        : await legacy.creditCommission({
            referenceId: 'order',
            cpf: '12345678901',
            amount,
            description: 'Comissão de afiliado',
          });
    const after = await current.finance.importEntry(
      { id: 'platform', tag: 'EBOOK', ownerUserId: 'owner', acquirer: 'DOM' },
      {
        referenceId: 'order',
        amountCents: 1234,
        netAmountCents: Math.round(net * 100),
        kind,
        paymentMethod: 'PIX',
        description: kind === 'pending' ? 'order' : 'Comissão de afiliado',
        ...(kind === 'pending'
          ? {
              customerName: 'Buyer',
              customerEmail: 'buyer@example.com',
              customerDocument: '123.456.789-01',
            }
          : {}),
      },
    );
    expect(after).toEqual(before);
    const a = old.prisma.transaction.create.mock.calls[0][0].data,
      b = current.prisma.transaction.create.mock.calls[0][0].data;
    // PostgreSQL columns are Decimal(12,2); compare persisted precision.
    for (const key of ['amount', 'netAmount'])
      expect(new Prisma.Decimal(a[key]).toFixed(2)).toEqual(
        new Prisma.Decimal(b[key]).toFixed(2),
      );
    for (const key of [
      'userId',
      'status',
      'paymentMethod',
      'description',
      'domPaymentId',
      'installments',
    ])
      expect(a[key]).toEqual(b[key]);
    if (kind === 'pending')
      for (const key of ['customerName', 'customerEmail', 'customerDocument'])
        expect(a[key]).toEqual(b[key]);
    expect(old.prisma.wallet.update).not.toHaveBeenCalled();
    expect(current.prisma.wallet.update).not.toHaveBeenCalled();
  });
