import { beforeAll, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { PlatformMerchantsService } from './platform-merchants.service';
import { initializePlatformTaxasCache } from '../platform-taxas/platform-taxas.store';
import { platformFeeSchedule } from '../financial-policy/platform-fee-schedule';

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
  tag: 'EBOOK',
  ownerUserId: 'owner',
  acquirer: 'DOM' as const,
};

function feeRow(method: string, installments: number, ratePpm: number) {
  return {
    id: `${method}${installments}`,
    acquirerCode: 'DOM',
    method,
    channel: 'ONLINE',
    installments,
    fixedCents: 100,
    ratePpm,
    interestPpm: installments > 1 ? 10_000 * installments : 0,
    base: 'ORIGINAL',
    source: 'TEST',
    createdAt: new Date(0),
  };
}
function policyPrisma(extra: Record<string, unknown> = {}, target = 149_900) {
  const rows = [
    feeRow('PIX', 1, 9_800),
    feeRow('DEBIT_CARD', 1, 15_000),
    feeRow('BOLETO', 1, 0),
    ...Array.from({ length: 12 }, (_, i) =>
      feeRow('CREDIT_CARD', i + 1, 39_900),
    ),
  ];
  return {
    financialPolicyRevision: {
      findMany: async () => [
        {
          tag: 'GLOBAL',
          version: 1,
          document: {
            schemaVersion: 1,
            lanes: {},
            owner: {},
            ...(target ? { targetFeePpm: target } : {}),
          },
        },
      ],
    },
    platform: {
      findUnique: async () => ({
        acquirer: 'DOM',
        feeMode: null,
        targetFeePpm: null,
        additiveFees: null,
      }),
    },
    acquirerCatalogue: { findMany: async () => [{ code: 'DOM' }] },
    acquirerFeeSchedule: {
      findMany: async ({ where }: any) =>
        rows.filter(
          (row) =>
            row.method === where.method &&
            row.channel === where.channel &&
            row.installments === where.installments,
        ),
    },
    ...extra,
  } as any;
}
function merchantPrisma(extra: Record<string, unknown> = {}) {
  return policyPrisma({
    integrationMerchant: {
      findUnique: async () => ({
        id: 'm',
        userId: 'seller',
        integrationKey: 'platform:p',
        user: { isActive: true, isPurged: false },
      }),
    },
    ...extra,
  });
}

test('fee schedule follows the platform target rate, not the LIQUIDEZ default', async () => {
  const schedule = await platformFeeSchedule(policyPrisma(), 'EBOOK');
  expect(schedule.effectiveTargetFeePpm).toBe(149_900);
  expect(schedule.pix).toMatchObject({
    available: true,
    processingFeeCents: 1_499,
    processingRatePpm: 149_900,
    netCents: 8_501,
  });
  expect(schedule.debit).toMatchObject({ processingRatePpm: 149_900 });
  expect(schedule.credit).toHaveLength(12);
  // Installment interest is reported apart from the processing fee.
  expect(schedule.credit[11]).toMatchObject({
    installments: 12,
    processingRatePpm: 149_900,
  });
  expect(
    schedule.credit[11]!.available && schedule.credit[11]!.interestCostCents,
  ).toBeGreaterThan(0);
});

test('merchant fees expose withdrawal policy and per-transaction fees in cents', async () => {
  const prisma = merchantPrisma();
  const service = new PlatformMerchantsService(
    prisma,
    {} as never,
    new PlatformFinanceService(prisma),
  );
  const fees = await service.fees(context, 'seller-ext');
  expect(fees).toMatchObject({
    unit: 'cents',
    withdrawal: { minimumCents: 10_000, fixedFeeCents: 350, percentFee: 0 },
    transaction: { serviceFeeCents: 400, fixedFeeCents: 100 },
    referenceAmountCents: 10_000,
    effectiveTargetFeePpm: 149_900,
  });
});

test('merchant transactions are scoped to the merchant account and EBOOK tag, in cents', async () => {
  const findMany = mock(async () => [
    {
      id: 't1',
      amount: new Prisma.Decimal(100),
      netAmount: new Prisma.Decimal(85.01),
      platformFee: new Prisma.Decimal(14.99),
      acquirerFee: new Prisma.Decimal(0),
      status: 'COMPLETED',
      paymentMethod: 'PIX',
      description: 'ORD-2026-000001 [TENANT:EBOOK]',
      createdAt: new Date(2),
    },
    {
      id: 't2',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      platformFee: null,
      acquirerFee: null,
      status: 'COMPLETED',
      paymentMethod: 'PIX',
      description: 'Comissão [TENANT:EBOOK][AFFILIATE_COMMISSION]',
      createdAt: new Date(1),
    },
  ]);
  const prisma = merchantPrisma({ transaction: { findMany } });
  const service = new PlatformMerchantsService(
    prisma,
    {} as never,
    new PlatformFinanceService(prisma),
  );
  const result = await service.transactions(context, 'seller-ext', {
    page: 1,
    limit: 1,
    status: 'completed',
    description: 'ALL',
  });
  const where = (findMany.mock.calls[0] as any)[0].where;
  expect(where.userId).toBe('seller');
  expect(where.status).toBe('COMPLETED');
  expect(where.platformTag).toBeDefined();
  expect(where.description).toBeUndefined();
  expect(result.unit).toBe('cents');
  expect(result.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  expect(result.data).toHaveLength(1);
  expect(result.data[0]).toMatchObject({
    id: 't1',
    amountCents: 10_000,
    netAmountCents: 8_501,
    transactionFeeCents: 400,
    sellerNetCents: 8_101,
  });
  const second = await service.transactions(context, 'seller-ext', {
    page: 2,
    limit: 1,
  });
  expect(second.data[0]).toMatchObject({
    transactionFeeCents: 0,
    sellerNetCents: 1_000,
  });
});

function ledgerFixture() {
  const created: any[] = [];
  const prisma: any = merchantPrisma({
    platform: {
      findUnique: async () => ({
        isActive: true,
        ownerUserId: 'owner',
        acquirer: 'DOM',
        owner: { isActive: true },
      }),
    },
    user: { findUnique: async () => ({ isActive: true, isPurged: false }) },
    transaction: {
      findUnique: async ({ where }: any) =>
        created.find((row) => row.domPaymentId === where.domPaymentId) ?? null,
      create: mock(async ({ data }: any) => {
        const row = { id: `e${created.length + 1}`, ...data };
        created.push(row);
        return row;
      }),
    },
    wallet: {
      upsert: mock(async () => ({})),
      update: mock(async () => ({})),
      findUniqueOrThrow: mock(async () => ({
        balance: new Prisma.Decimal(0),
        lockedBalance: new Prisma.Decimal(0),
      })),
    },
    balanceLog: { create: mock(async () => ({})) },
  });
  prisma.$transaction = async (f: any) => f(prisma);
  const service = new PlatformMerchantsService(
    prisma,
    {} as never,
    new PlatformFinanceService(prisma),
  );
  return { prisma, service, created };
}

test('pending entry credits the merchant account, keeps legacy reference prefix and is idempotent', async () => {
  const { service, created, prisma } = ledgerFixture();
  const body = {
    referenceId: 'ORD-2026-000001',
    amountCents: 5_000,
    netAmountCents: 4_250,
    kind: 'pending',
    paymentMethod: 'PIX',
    description: 'ORD-2026-000001',
  };
  const first = await service.importEntry(context, 'seller-ext', body);
  expect(first).toMatchObject({ success: true, created: true });
  expect(created[0]).toMatchObject({
    userId: 'seller',
    domPaymentId: 'EBOOK_PENDING_ORD-2026-000001',
    status: 'PENDING',
  });
  expect(created[0].description).toBe('ORD-2026-000001 [TENANT:EBOOK]');
  expect(prisma.wallet.update).not.toHaveBeenCalled();
  expect(await service.importEntry(context, 'seller-ext', body)).toMatchObject({
    success: true,
    id: first.id,
    created: false,
  });
  expect(created).toHaveLength(1);
  await expect(
    service.importEntry(context, 'seller-ext', { ...body, amountCents: 6_000 }),
  ).rejects.toMatchObject({ status: 409 });
});

test('commission entry is a completed record without wallet credit, like the legacy credit-commission', async () => {
  const { service, created, prisma } = ledgerFixture();
  await service.importEntry(context, 'seller-ext', {
    referenceId: 'AFF-1-2',
    amountCents: 800,
    netAmountCents: 800,
    kind: 'commission',
    paymentMethod: 'PIX',
    description: 'Comissão de afiliado',
  });
  expect(created[0]).toMatchObject({
    userId: 'seller',
    domPaymentId: 'EBOOK_AFFCOMM_AFF-1-2',
    status: 'COMPLETED',
    description: 'Comissão de afiliado [TENANT:EBOOK][AFFILIATE_COMMISSION]',
  });
  expect(prisma.balanceLog.create).not.toHaveBeenCalled();
});

test('merchant ledger entries are EBOOK-only and reject unknown kinds', async () => {
  const { service } = ledgerFixture();
  await expect(
    service.importEntry({ ...context, tag: 'SHOP' }, 'seller-ext', {}),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.importEntry(context, 'seller-ext', {
      referenceId: 'x',
      amountCents: 100,
      netAmountCents: 100,
      kind: 'payment',
      paymentMethod: 'PIX',
    }),
  ).rejects.toMatchObject({ status: 400 });
});

const sale = (platformTag: string | null, net: number, description = '') => ({
  platformTag,
  netAmount: new Prisma.Decimal(net),
  financialSnapshot: null,
  description,
});
type Withdrawal = {
  platform: string | null;
  status: string;
  grossAmount: Prisma.Decimal;
};
const withdrawal = (
  platform: string | null,
  status: string,
  gross: number,
): Withdrawal => ({
  platform,
  status,
  grossAmount: new Prisma.Decimal(gross),
});
/** Seller with sales on EBOOK and on another platform, sharing one pooled wallet. */
function scopedFixture(
  pool: number,
  rows: any[],
  withdrawals: Withdrawal[] = [],
) {
  const wallet = {
    userId: 'seller',
    balance: new Prisma.Decimal(pool),
    lockedBalance: new Prisma.Decimal(0),
    version: 1,
  };
  const user = { id: 'seller', isActive: true, isPurged: false, wallet };
  const merchant = {
    id: 'm',
    integrationKey: 'platform:p',
    userId: 'seller',
    user,
  };
  const p: any = {
    platform: {
      count: async () => 2,
      findUnique: async () => ({
        ...context,
        isActive: true,
        owner: { isActive: true, isPurged: false },
      }),
    },
    integrationMerchant: { findUnique: async () => merchant },
    wallet: { findUnique: async () => wallet },
    transaction: { findMany: mock(async () => rows) },
    withdrawRequest: {
      aggregate: async () => ({
        _count: { id: 0 },
        _sum: { grossAmount: null },
      }),
      count: async () => 0,
      findMany: mock(async ({ where }: any) =>
        withdrawals.filter(
          (row) =>
            row.platform !== null &&
            where.platform.in.includes(row.platform.toLowerCase()) &&
            where.status.in.includes(row.status),
        ),
      ),
    },
    $transaction: async (callback: any) => callback(p),
  };
  return {
    p,
    service: new PlatformMerchantsService(
      p,
      {} as never,
      new PlatformFinanceService(p),
    ),
  };
}
const mixed = [
  sale('EBOOK', 100, 'ORD-2026-000001 [TENANT:EBOOK]'),
  sale('EBOOK', 50, 'ORD-2026-000002 [TENANT:EBOOK]'),
  sale('EBOOK', 10, 'Comissão [TENANT:EBOOK][AFFILIATE_COMMISSION]'),
  sale('BOSQUE', 300, '[TENANT:BOSQUE]'),
  sale(null, 70, 'untagged history'),
];

test('EBOOK merchant summary counts only EBOOK sales (net of the sale fee), not the pooled wallet', async () => {
  const { p, service } = scopedFixture(500, mixed);
  const summary = await service.summary(context, 'seller-ext');
  // (100 - 4) + (50 - 4); the commission was only recorded, BOSQUE and untagged rows never count.
  expect(summary).toMatchObject({
    walletScope: 'merchant-platform',
    unit: 'cents',
    poolBalanceCents: 50_000,
    earnedCents: 14_200,
    balanceCents: 14_200,
    availableBalanceCents: 14_200,
  });
  expect(p.transaction.findMany.mock.calls[0][0].where).toEqual({
    userId: 'seller',
    status: 'COMPLETED',
  });
});

test('EBOOK reservations and settled withdrawals reduce only the EBOOK balance', async () => {
  const { service } = scopedFixture(500, mixed, [
    withdrawal('ebook', 'PENDING', 40),
    withdrawal('ebook', 'COMPLETED', 30),
    withdrawal('bosque', 'COMPLETED', 200),
  ]);
  expect(await service.summary(context, 'seller-ext')).toMatchObject({
    earnedCents: 14_200,
    withdrawnGrossCents: 3_000,
    balanceCents: 11_200,
    lockedBalanceCents: 4_000,
    availableBalanceCents: 7_200,
  });
});

test('EBOOK balance never exceeds what the pooled wallet actually holds', async () => {
  const { service } = scopedFixture(60, mixed);
  expect(await service.summary(context, 'seller-ext')).toMatchObject({
    earnedCents: 14_200,
    availableBalanceCents: 6_000,
  });
});

test('platform owner balance keeps its checks: merchant mode reuses the real platform context', async () => {
  const { p } = scopedFixture(500, mixed);
  p.platform.findUnique = async () => ({
    ...context,
    ownerUserId: 'someone-else',
    isActive: true,
    owner: { isActive: true, isPurged: false },
  });
  const { merchantScopedBalance } = await import('./platform-merchant-balance');
  await expect(
    merchantScopedBalance(p, context, 'seller'),
  ).rejects.toMatchObject({ status: 409 });
});

test('EBOOK merchant withdrawal cannot draw on funds earned elsewhere', async () => {
  const f = scopedFixture(500, mixed);
  const p = f.p;
  p.$executeRaw = mock(async () => 1);
  p.integrationWebhookDelivery = { create: mock(async () => ({})) };
  p.balanceLog = { create: mock(async () => ({})) };
  p.wallet.findUniqueOrThrow = async () => p.wallet.findUnique();
  p.withdrawRequest.findUnique = async () => null;
  p.withdrawRequest.findFirst = async () => null;
  p.withdrawRequest.create = mock(async ({ data }: any) => ({
    id: 'w',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    rejectionReason: null,
    ...data,
  }));
  p.withdrawRequest.findUniqueOrThrow = async () => ({
    pixKey: 'key',
    rejectionReason: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  const service = new PlatformMerchantsService(
    p,
    {} as never,
    new PlatformFinanceService(p),
  );
  // The pool holds R$ 500 but EBOOK earned R$ 142.
  await expect(
    service.withdraw(context, 'seller-ext', {
      amountCents: 20_000,
      pixKey: 'key',
      idempotencyKey: 'r1',
    }),
  ).rejects.toThrow('Saldo insuficiente na plataforma');
  expect(p.withdrawRequest.create).not.toHaveBeenCalled();
  expect(p.balanceLog.create).not.toHaveBeenCalled();
  const ok = await service.withdraw(context, 'seller-ext', {
    amountCents: 14_000,
    pixKey: 'key',
    idempotencyKey: 'r2',
  });
  expect(ok).toMatchObject({ grossAmountCents: 14_000 });
  expect(p.withdrawRequest.create).toHaveBeenCalledTimes(1);
});
