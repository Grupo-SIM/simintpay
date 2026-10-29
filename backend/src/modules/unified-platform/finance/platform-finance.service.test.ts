import { beforeAll, describe, expect, mock, test } from 'bun:test';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';
import { PlatformFinanceService } from './platform-finance.service';
import { InternalAtlasFinanceController } from '../../../presentation/controllers/internal-atlas-finance.controller';
import type { InternalAtlasFinanceService } from './legacy-atlas-finance.service';

beforeAll(async () => {
  await initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as any);
});

const context = {
  id: 'platform',
  tag: 'SHOP',
  ownerUserId: 'owner',
  acquirer: 'FRENDZ' as const,
};
const decimal = (value: number) => new Prisma.Decimal(value);
function fixture() {
  const prisma = {
    wallet: {
      findUnique: mock(async () => ({
        id: 'wallet',
        balance: decimal(500),
        lockedBalance: decimal(20),
        version: 3,
      })),
      updateMany: mock(async () => ({ count: 1 })),
    },
    platform: {
      findUnique: mock(async () => ({
        ...context,
        isActive: true,
        owner: { isActive: true, isPurged: false },
      })),
      count: mock(async () => 2),
      findMany: mock(async () => [{ tag: 'SHOP' }, { tag: 'OTHER' }]),
    },
    withdrawRequest: {
      aggregate: mock(async () => ({ _sum: { grossAmount: decimal(30) } })),
      findUnique: mock(async (): Promise<any> => null),
      create: mock(async ({ data }: any) => ({ id: 'withdrawal', ...data })),
      count: mock(async () => 0),
      findMany: mock(async () => []),
    },
    transaction: {
      count: mock(async () => 0),
      findMany: mock(async () => []),
      aggregate: mock(async () => ({
        _count: 0,
        _sum: {
          amount: null,
          netAmount: null,
          platformFee: null,
          domFee: null,
        },
      })),
    },
    balanceLog: { create: mock(async () => ({})) },
    $transaction: mock(async (callback: any) => callback(prisma)),
  };
  return {
    prisma,
    service: new PlatformFinanceService(prisma as unknown as PrismaService),
  };
}

describe('Shared platform finance', () => {
  test('reports wallet as shared owner cents without inventing platform balances', async () => {
    const { service } = fixture();
    expect(await service.summary(context)).toMatchObject({
      walletScope: 'shared-owner',
      sharedWallet: true,
      availableBalanceCents: 48000,
      pendingPlatformWithdrawalsCents: 3000,
    });
    expect(service.cents('0.29')).toBe(29);
  });
  test('transactions preserve explicit tenant and owner scope', async () => {
    const { service, prisma } = fixture();
    await service.transactions(context);
    expect(prisma.transaction.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: 'owner', description: { contains: '[TENANT:SHOP]' } },
    });
    await service.report(context);
    expect(prisma.transaction.findMany.mock.calls[1][0]).toMatchObject({
      where: {
        description: { contains: '[TENANT:SHOP]' },
        status: 'COMPLETED',
      },
    });
  });
  test('blocks maintenance of shared owner wallet', async () => {
    const { service } = fixture();
    await expect(
      service.ensureMaintenanceSafe('owner', 'SHOP'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
  test('canonical withdrawal reserves once and preserves configured acquirer', async () => {
    const { service, prisma } = fixture();
    const result = await service.requestWithdrawal(context, {
      amountCents: 10000,
      pixKey: 'key',
      idempotencyKey: 'order-1',
    });
    expect(result).toMatchObject({
      status: 'PENDING',
      grossAmountCents: 10000,
      feeCents: 350,
      amountCents: 9650,
    });
    expect(prisma.wallet.updateMany.mock.calls[0][0]).toMatchObject({
      where: { version: 3 },
      data: { lockedBalance: { increment: decimal(100) } },
    });
    expect(prisma.withdrawRequest.create.mock.calls[0][0].data).toMatchObject({
      remainingBalanceAfterWithdrawal: decimal(380),
      acquirer: 'FRENDZ',
      platform: 'shop',
      integrationRequestId: 'platform:platform:order-1',
    });
  });
  test('duplicate request does not reserve wallet again', async () => {
    const { service, prisma } = fixture();
    prisma.withdrawRequest.findUnique.mockImplementation(async () => ({
      id: 'prior',
      userId: 'owner',
      grossAmount: decimal(100),
      amount: decimal(98),
      fee: decimal(2),
      pixKey: 'key',
      status: 'PENDING',
    }));
    expect(
      (
        await service.requestWithdrawal(context, {
          amountCents: 10000,
          pixKey: 'key',
          idempotencyKey: 'order-1',
        })
      ).id,
    ).toBe('prior');
    expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
    await expect(
      service.requestWithdrawal(context, {
        amountCents: 12000,
        pixKey: 'key',
        idempotencyKey: 'order-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  test('optimistic wallet conflict blocks withdrawal persistence', async () => {
    const { service, prisma } = fixture();
    prisma.wallet.updateMany.mockImplementation(async () => ({ count: 0 }));
    await expect(
      service.requestWithdrawal(context, {
        amountCents: 10000,
        pixKey: 'key',
        idempotencyKey: 'order-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.withdrawRequest.create).not.toHaveBeenCalled();
  });
  test('rejects fractional cents before persistence', async () => {
    const { service, prisma } = fixture();
    await expect(
      service.requestWithdrawal(context, {
        amountCents: 10000.5,
        pixKey: 'key',
        idempotencyKey: 'order-1',
      }),
    ).rejects.toThrow();
    expect(prisma.withdrawRequest.create).not.toHaveBeenCalled();
  });
  test('legacy alias forwards contract arguments and response unchanged', async () => {
    const response = {
      availableBalance: 12.34,
      pendingWithdraws: 0,
      lockedBalance: 0,
      userExists: true,
    };
    const summary = mock(async () => response);
    const controller = new InternalAtlasFinanceController({
      summary,
    } as unknown as InternalAtlasFinanceService);
    expect(
      await controller.summary(
        '123',
        'owner@example.com',
        'account',
        'legacy-token',
      ),
    ).toBe(response);
    expect(summary).toHaveBeenCalledWith(
      '123',
      'owner@example.com',
      'account',
      'legacy-token',
    );
  });

  test('every wallet reservation writes a WITHDRAW_REQUESTED log, even from legacy callers', async () => {
    const { prisma, service } = fixture();
    await service.createWithdrawal({
      userId: 'owner',
      platform: 'shop',
      amount: 90,
      grossAmount: 100,
      fee: 10,
      pixKey: 'key',
      reserveWallet: true,
    });
    expect(prisma.balanceLog.create).toHaveBeenCalledTimes(1);
    const data = (prisma.balanceLog.create.mock.calls as any)[0][0].data;
    expect(data).toMatchObject({
      userId: 'owner',
      action: 'WITHDRAW_REQUESTED',
      source: 'WITHDRAW',
    });
    expect([data.lockedBefore.toFixed(2), data.lockedAfter.toFixed(2)]).toEqual(
      ['20.00', '120.00'],
    );
    expect(data.balanceBefore.toFixed(2)).toBe(data.balanceAfter.toFixed(2));
  });
});

test('canonical import uses authenticated wallet and strict cents', async () => {
  const { service } = fixture();
  const record = mock(async (...args: any[]) => {
    void args;
    return { success: true, id: 'entry', created: true };
  });
  service.recordEntry = record;
  const platform = { ...context, tag: 'PAGATG' };
  const body = {
    referenceId: 'invoice',
    amountCents: 1234,
    netAmountCents: 1200,
    kind: 'payment',
    paymentMethod: 'PIX',
  };
  await service.importEntry(platform, body);
  expect(record.mock.calls[0][1]).toMatchObject({
    userId: 'owner',
    domPaymentId: 'invoice',
    status: 'COMPLETED',
  });
  expect(record.mock.calls[0][1].amount.toString()).toBe('12.34');
  expect(record.mock.calls[0][2]).toBe(true);
  for (const change of [
    { userId: 'foreign' },
    { amountCents: 12.34 },
    { kind: 'commission' },
  ]) {
    await expect(
      service.importEntry(platform, { ...body, ...change }),
    ).rejects.toThrow();
  }
  expect(record).toHaveBeenCalledTimes(1);
});

test('ambiguous history excluded before pagination, counts and financial sums', async () => {
  const { service, prisma } = fixture();
  const row = (id: string, description: string, status = 'COMPLETED') => ({
    id,
    description,
    status,
    amount: decimal(10.29),
    netAmount: decimal(9.99),
    platformFee: decimal(0.2),
    domFee: decimal(0.1),
  });
  prisma.transaction.findMany.mockImplementation(
    async () =>
      [
        row('mixed', '[TENANT:SHOP][TENANT:OTHER]'),
        row('valid', '[TENANT:SHOP]'),
      ] as any,
  );
  expect(await service.transactions(context, { limit: 1 })).toMatchObject({
    data: [{ id: 'valid', amountCents: 1029 }],
    meta: { total: 1, totalPages: 1 },
  });
  expect(await service.report(context)).toMatchObject({
    completedTransactions: 1,
    grossAmountCents: 1029,
    netAmountCents: 999,
    platformFeeCents: 20,
    acquirerFeeCents: 10,
  });
  for (const status of ['CHARGEBACK', 'IN_MEDIATION'])
    await service.transactions(context, { status });
});
