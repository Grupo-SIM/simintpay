import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { settleFinancialSubscription } from './financial-subscription';

const snapshot = {
  version: '1:0',
  policyTag: 'GLOBAL',
  key: 'DOM/PIX/ONLINE/1',
  originalCents: 10000,
  buyerTotalCents: 10000,
  netCents: 9500,
  contractedCostCents: 500,
  acquirerCost: {
    acquirer: 'DOM',
    source: 'UNCONFIGURED',
    realizedCents: null,
  },
};

test('subscription renewal persists unknown realized cost without inventing a profit', async () => {
  let created: Prisma.TransactionUncheckedCreateInput | undefined;
  const tx = {
    wallet: { upsert: async () => ({}) },
    transaction: {
      upsert: async ({
        create,
      }: {
        create: Prisma.TransactionUncheckedCreateInput;
      }) => {
        created = create;
        return {
          ...create,
          status: 'COMPLETED',
          settlementBasis: 'FINAL_NET',
          paymentLinkId: null,
        };
      },
    },
  };
  const prisma = {
    financialPolicyRevision: { findMany: async () => [] },
    $transaction: async (callback: (client: typeof tx) => Promise<void>) =>
      callback(tx),
  } as unknown as PrismaService;

  const quote = await settleFinancialSubscription(prisma, {
    snapshot,
    amount: new Prisma.Decimal(100),
    paymentId: 'renewal-unknown-cost',
    userId: 'owner',
    method: 'PIX',
    name: 'Subscription',
  });

  expect(quote?.financialSnapshot.acquirerCost).toEqual(snapshot.acquirerCost);
  expect(quote && 'platformProfit' in quote).toBe(false);
  expect(created?.financialSnapshot).toEqual(snapshot);
  expect(new Prisma.Decimal(created!.totalFee!).toNumber()).toBe(5);
  expect(new Prisma.Decimal(created!.domFee!).toNumber()).toBe(0);
  expect(new Prisma.Decimal(created!.platformFee!).toNumber()).toBe(0);
});
