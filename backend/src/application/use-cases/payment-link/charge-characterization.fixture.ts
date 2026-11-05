import { Prisma } from '@prisma/client';
import { initializePlatformIntegrationsCache } from '../../../modules/platform-integrations/platform-integrations.store';
import { initializePlatformRegistryCache } from '../../../modules/module.registry';
import { initializePlatformTaxasCache } from '../../../modules/platform-taxas/platform-taxas.store';

/**
 * Shared in-memory fake of the Prisma surface touched by the link / boleto / subscription PIX charges.
 * CHARACTERIZATION fixture: it records what the use cases write, it does not validate it.
 */
export type FixtureOptions = {
  /** Registers a PIX lane in the GLOBAL financial policy so quoteFinancialCharge returns a quote. */
  financial?: boolean;
  /** Row returned by the coproduction agreement lookup ($queryRaw). */
  agreement?: { version: number; participants: unknown[]; mode?: string };
  offers?: any[];
  /** Parent transaction visible to resolveFunnelOffer. */
  parent?: any;
  funnelSales?: any[];
  /** How many of funnelSales are COMPLETED transactions. */
  paidFunnelCount?: number;
};

export const PIX_LANE_POLICY = {
  schemaVersion: 1,
  lanes: {
    'DOM/PIX/ONLINE/1': {
      active: true,
      contract: {
        reference: 'Signed',
        fixedCents: 50,
        ratePpm: 9800,
        cashbackCents: 0,
        interestPpm: 0,
        base: 'ORIGINAL',
      },
      sim: { fixedCents: 200, ratePpm: 20000, interestPpm: 0 },
    },
  },
  owner: {},
  interestFree: false,
};

/** Never let the taxa / registry caches reach a real database (they refresh lazily from DATABASE_URL). */
export async function useEmptyCaches() {
  const empty = {
    platformTaxaOverride: { findMany: async () => [] },
    platform: { findMany: async () => [] },
    platformIntegration: { findMany: async () => [] },
  };
  await initializePlatformTaxasCache(empty as never);
  await initializePlatformRegistryCache(empty as never);
  await initializePlatformIntegrationsCache(empty as never);
}

export function makeFakePrisma(opts: FixtureOptions = {}) {
  let rows: any[] = [];
  let wallet: any = {
    id: 'wallet',
    userId: 'owner',
    balance: new Prisma.Decimal(0),
    lockedBalance: new Prisma.Decimal(0),
    version: 0,
  };
  let logs: any[] = [];
  const offerSales: any[] = [];
  const walletUpserts: any[] = [];
  const subscriptionOrderUpdates: any[] = [];
  const p: any = {
    user: { findUnique: async () => null },
    affiliateCommission: { findUnique: async () => null },
    acquirerCatalogue: { findMany: async () => [] },
    acquirerFeeSchedule: { findMany: async () => [] },
    transaction: {
      create: async ({ data }: any) => {
        const row = { ...data, domPaymentId: data.domPaymentId ?? null };
        rows.push(row);
        return row;
      },
      upsert: async ({ where, create, update }: any) => {
        const found = rows.find((r) => r.domPaymentId === where.domPaymentId);
        if (found) return Object.assign(found, update);
        const row = { id: `tx-${rows.length + 1}`, ...create };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => {
        const r = rows.find((x) => x.id === where.id);
        return r ? { ...r } : null;
      },
      findFirst: async () => opts.parent ?? null,
      count: async () => opts.paidFunnelCount ?? 0,
      deleteMany: async ({ where }: any) => {
        const before = rows.length;
        rows = rows.filter(
          (r) => !(r.id === where.id && r.status === where.status),
        );
        return { count: before - rows.length };
      },
      updateMany: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        if (where.domPaymentId === null && row.domPaymentId !== null)
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    wallet: {
      upsert: async (args: any) => {
        walletUpserts.push(args);
        return wallet;
      },
      findUnique: async () => ({ ...wallet }),
      findUniqueOrThrow: async () => ({ ...wallet }),
      create: async () => wallet,
    },
    balanceLog: {
      findFirst: async () => logs[0],
      create: async ({ data }: any) => {
        logs.push(data);
        wallet = {
          ...wallet,
          balance: wallet.balance.add(data.balanceDelta ?? 0),
          lockedBalance: wallet.lockedBalance.add(data.lockedDelta ?? 0),
          version: wallet.version + 1,
        };
      },
    },
    transactionStatusHistory: { create: async () => {} },
    paymentLinkOffer: {
      findMany: async () => opts.offers ?? [],
      findFirst: async () => (opts.offers ?? [])[0] ?? null,
    },
    paymentLinkOfferSale: {
      findMany: async () => opts.funnelSales ?? [],
      createMany: async ({ data }: any) => {
        offerSales.push(...data);
      },
    },
    subscriptionLinkOrder: {
      update: async (args: any) => {
        subscriptionOrderUpdates.push(args);
        return { id: args.where.id, status: 'pending', ...args.data };
      },
    },
  };
  const agreement = opts.agreement;
  const prisma: any = {
    ...p,
    $queryRaw: async (strings: any) => {
      const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (sql.includes('CoproductionAgreement') && agreement)
        return [{ mode: 'OWN', ...agreement }];
      return [];
    },
    acquirerCatalogue: {
      findMany: async () => (opts.financial ? [{ code: 'DOM' }] : []),
    },
    acquirerFeeSchedule: {
      findMany: async ({ where }: any) =>
        opts.financial &&
        where.method === 'PIX' &&
        where.channel === 'ONLINE' &&
        where.installments === 1
          ? [
              {
                acquirerCode: 'DOM',
                fixedCents: 50,
                ratePpm: 9800,
                interestPpm: 0,
                base: 'ORIGINAL',
                source: 'Signed',
                createdAt: new Date('2026-01-01'),
                id: 'fee',
              },
            ]
          : [],
    },
    financialPolicyRevision: {
      findMany: async () =>
        opts.financial
          ? [{ tag: 'GLOBAL', version: 1, document: PIX_LANE_POLICY }]
          : [],
    },
    platform: { findUnique: async () => null },
    $transaction: async (fn: any) => {
      const beforeRows = rows.map((r) => ({ ...r }));
      const beforeWallet = { ...wallet };
      const beforeLogs = [...logs];
      try {
        return await fn(p);
      } catch (e) {
        rows = beforeRows;
        wallet = beforeWallet;
        logs = beforeLogs;
        throw e;
      }
    },
  };
  return {
    prisma,
    rows: () => rows,
    row: () => rows[rows.length - 1],
    wallet: () => wallet,
    logs: () => logs,
    offerSales,
    walletUpserts,
    subscriptionOrderUpdates,
  };
}

export function makeOffer(over: Record<string, unknown> = {}) {
  return {
    id: 'bump-1',
    paymentLinkId: 'link',
    type: 'ORDER_BUMP',
    title: 'Bump',
    price: new Prisma.Decimal(20),
    isActive: true,
    deletedAt: null,
    position: 0,
    ...over,
  };
}

export function makeLink(over: Record<string, unknown> = {}): any {
  return {
    id: 'link',
    userId: 'owner',
    isActive: true,
    domPaymentLinkId: 'dom-link',
    amount: 100,
    title: 'Plan',
    description: null,
    isStandalone: true,
    plataformas: ['GLOBAL'],
    aceitaPix: true,
    maxUses: null,
    currentUses: 0,
    expiresAt: null,
    webhookUrl: null,
    ...over,
  };
}

/** Numbers as persisted on the Transaction (Decimal -> number, float noise below 1e-6 rounded away). */
export function money(row: any) {
  const n = (v: any) =>
    v == null ? v : Math.round(Number(v.toString()) * 1e6) / 1e6;
  return {
    amount: n(row.amount),
    netAmount: n(row.netAmount),
    totalFee: n(row.totalFee),
    domFee: n(row.domFee),
    platformFee: n(row.platformFee),
  };
}

export async function withAreaflixPlatform<T>(fn: () => Promise<T>) {
  await initializePlatformRegistryCache({
    platform: {
      findMany: async () => [
        {
          id: 'af',
          tag: 'AREAFLIX',
          name: 'Areaflix',
          ownerUserId: 'af-owner',
          acquirer: 'DOM',
          customerInterestRates: {},
          absorbCustomerInterest: false,
        },
      ],
    },
  } as never);
  await initializePlatformIntegrationsCache({
    platformIntegration: {
      findMany: async () => [
        {
          platform: { tag: 'AREAFLIX' },
          key: 'DOM_TOKEN',
          encryptedValue: null,
          url: 'areaflix-token',
        },
      ],
    },
  } as never);
  try {
    return await fn();
  } finally {
    await useEmptyCaches();
  }
}
