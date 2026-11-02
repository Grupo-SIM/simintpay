import { beforeAll, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { IntegrationFinanceService } from '../integrations/integration-finance.service';
import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { PlatformMerchantsService } from './platform-merchants.service';
import { initializePlatformTaxasCache } from '../platform-taxas/platform-taxas.store';
beforeAll(async () =>
  initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
    acquirerCatalogue: { findMany: async () => [{ code: 'DOM' }] },
    acquirerWithdrawalFee: {
      findMany: async () => [
        { id: '1', acquirerCode: 'DOM', feeCents: 350, createdAt: new Date() },
      ],
    },
  } as any),
);
const context = {
  id: 'p',
  tag: 'SHOP',
  ownerUserId: 'owner',
  acquirer: 'DOM' as const,
};
function fixture(namespace: string) {
  const wallet = {
    id: 'wallet',
    balance: new Prisma.Decimal(500),
    lockedBalance: new Prisma.Decimal(0),
    version: 3,
  };
  const merchant = {
    id: 'm',
    integrationKey: namespace,
    userId: 'seller',
    user: { isActive: true, wallet },
  };
  const p: any = {
    platform: {
      findUnique: async () => ({
        ...context,
        isActive: true,
        owner: { isActive: true },
      }),
    },
    platformIntegration: {
      findMany: async () => [{ url: 'legacy', platform: context }],
      findUnique: async () => ({ url: 'legacy' }),
    },
    integrationMerchant: { findUnique: async () => merchant },
    wallet: {
      findUnique: async () => wallet,
      findUniqueOrThrow: async () => wallet,
    },
    $executeRaw: mock(async () => 1),
    withdrawRequest: {
      findUniqueOrThrow: async () => ({
        pixKey: 'key',
        rejectionReason: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
      findUnique: async () => null,
      findFirst: async () => null,
      create: mock(async ({ data }: any) => ({
        id: 'w',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        rejectionReason: null,
        ...data,
      })),
    },
    integrationWebhookDelivery: { create: mock(async () => ({})) },
    balanceLog: { create: mock(async () => ({})) },
    $transaction: async (f: any) => f(p),
  };
  return {
    p,
    wallet,
    merchant,
    legacy: new IntegrationFinanceService(p),
    canonical: new PlatformMerchantsService(
      p,
      {} as any,
      new PlatformFinanceService(p),
    ),
  };
}
test('merchant legacy and canonical withdrawals share reserve, fees, ledger and atomic outbox', async () => {
  const a = fixture('legacy'),
    b = fixture('platform:p');
  const old = await a.legacy.requestWithdrawal('legacy', 'external', {
    grossAmountCents: 12000,
    pixKey: 'key',
    requestId: 'request',
  });
  const current = await b.canonical.withdraw(context, 'external', {
    amountCents: 12000,
    pixKey: 'key',
    idempotencyKey: 'request',
  });
  expect(old).toMatchObject({
    grossAmountCents: 12000,
    netAmountCents: 11650,
    feeCents: 350,
  });
  expect(current).toMatchObject({
    grossAmountCents: old.grossAmountCents,
    amountCents: old.netAmountCents,
    feeCents: old.feeCents,
  });
  expect(a.p.balanceLog.create.mock.calls).toEqual(
    b.p.balanceLog.create.mock.calls,
  );
  const data = (p: any) => {
    const result = { ...p.withdrawRequest.create.mock.calls[0][0].data };
    delete result.integrationRequestId;
    return result;
  };
  expect(data(a.p)).toEqual(data(b.p));
  expect(
    a.p.integrationWebhookDelivery.create.mock.calls[0][0].data.payload,
  ).toMatchObject({ requestId: 'request', status: 'PENDING' });
  expect(
    b.p.integrationWebhookDelivery.create.mock.calls[0][0].data.payload,
  ).toMatchObject({ requestId: 'platform:p:m:request', status: 'PENDING' });
});
test('merchant insufficient balance under the ledger lock and revoked product binding stop persistence and outbox', async () => {
  const a = fixture('legacy');
  a.wallet.balance = new Prisma.Decimal(10);
  await expect(
    a.legacy.requestWithdrawal('legacy', 'external', {
      grossAmountCents: 12000,
      pixKey: 'key',
      requestId: 'r',
    }),
  ).rejects.toThrow('Saldo insuficiente');
  expect(a.p.withdrawRequest.create).not.toHaveBeenCalled();
  expect(a.p.integrationWebhookDelivery.create).not.toHaveBeenCalled();
  a.p.platformIntegration.findUnique = async () => ({ url: 'revoked' });
  await expect(
    a.legacy.requestWithdrawal('legacy', 'external', {
      grossAmountCents: 12000,
      pixKey: 'key',
      requestId: 'r',
    }),
  ).rejects.toThrow('Vínculo legado');
});
test('merchant idempotency mismatch never reserves twice', async () => {
  const { p, legacy } = fixture('legacy');
  p.withdrawRequest.findUnique = async () => ({
    userId: 'seller',
    grossAmount: new Prisma.Decimal(120),
    pixKey: 'other',
  });
  await expect(
    legacy.requestWithdrawal('legacy', 'external', {
      grossAmountCents: 12000,
      pixKey: 'key',
      requestId: 'r',
    }),
  ).rejects.toThrow('outro contrato');
  expect(p.balanceLog.create).not.toHaveBeenCalled();
});
