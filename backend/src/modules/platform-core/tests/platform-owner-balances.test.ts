import 'reflect-metadata';
import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformAttributedBalance } from '../platform-attributed-balance';
import { PlatformContextService } from '../platform-context.service';
import { PlatformOperationsController } from '../platform-operations.controller';

test('owner reads independent product projections against one shared wallet', async () => {
  const owner = { id: 'owner', isActive: true, isPurged: false, role: 'USER' };
  const products = ['PRODUCT-A', 'PRODUCT-B'].map((tag) => ({
    id: tag,
    tag,
    ownerUserId: owner.id,
    owner,
    isActive: true,
    acquirer: 'DOM',
  }));
  const withdrawals = [
    {
      platform: 'product-a',
      userId: owner.id,
      grossAmount: new Prisma.Decimal(12),
      status: 'COMPLETED',
    },
    {
      platform: 'product-b',
      userId: owner.id,
      grossAmount: new Prisma.Decimal(7),
      status: 'PENDING',
    },
  ];
  const p: any = {
    platform: {
      findUnique: async ({ where }: any) =>
        products.find(
          (product) => product.id === where.id || product.tag === where.tag,
        ),
      count: async () => products.length,
    },
    user: {
      findUnique: async ({ where }: any) => ({ ...owner, id: where.id }),
    },
    transaction: {
      findMany: async ({ where }: any) => {
        expect(where).toEqual({ userId: owner.id, status: 'COMPLETED' });
        return [
          {
            description: '[TENANT:PRODUCT-A]',
            platformTag: 'PRODUCT-A',
            netAmount: new Prisma.Decimal(50),
          },
          {
            description: '[TENANT:PRODUCT-B]',
            platformTag: 'PRODUCT-B',
            netAmount: new Prisma.Decimal(90),
          },
          {
            description: 'unattributed history',
            netAmount: new Prisma.Decimal(400),
          },
        ];
      },
    },
    withdrawRequest: {
      findMany: async ({ where }: any) =>
        withdrawals.filter(
          (row) =>
            row.userId === where.userId &&
            where.platform.in.includes(row.platform),
        ),
      count: async () => 0,
    },
    wallet: { findUnique: async () => ({ balance: new Prisma.Decimal(528) }) },
    $transaction: async (fn: any, options: any) => {
      expect(options.isolationLevel).toBe('RepeatableRead');
      return fn(p);
    },
  };
  const contexts = new PlatformContextService(p);
  const balances = new PlatformAttributedBalance(p);
  const controller = new PlatformOperationsController(
    { platformBalance: (context: any) => balances.read(context) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  expect(
    Reflect.getMetadata('platform-operation', controller.platformBalance),
  ).toBe('finance:read');
  const actor = { sub: owner.id, email: 'owner@example.com', role: 'USER' };
  const results = [];
  for (const product of products) {
    const platformContext = await contexts.authorize(
      product.tag,
      'finance:read',
      actor,
    );
    results.push(await controller.platformBalance({ platformContext }));
  }
  expect(results[0]).toMatchObject({
    platformTag: 'PRODUCT-A',
    balanceCents: 3800,
    availableBalanceCents: 3800,
  });
  expect(results[1]).toMatchObject({
    platformTag: 'PRODUCT-B',
    balanceCents: 9000,
    availableBalanceCents: 8300,
  });
  for (const result of results)
    expect(result).toMatchObject({
      ownerUserId: owner.id,
      walletScope: 'shared-owner',
      ownerWalletBalanceCents: 52800,
      unidentifiedOwnerTransactions: 1,
      historicalAttributionComplete: false,
    });
  await expect(
    contexts.authorize('PRODUCT-A', 'finance:read', {
      ...actor,
      sub: 'other-owner',
    }),
  ).rejects.toThrow('Plataforma pertence a outro usuário');
});
