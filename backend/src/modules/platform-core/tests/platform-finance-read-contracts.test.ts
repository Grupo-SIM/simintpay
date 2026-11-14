import { matches } from './platform-query-fixture';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformFinanceService } from '../../unified-platform/finance/platform-finance.service';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';
import { InternalAtlasFinanceService } from '../../unified-platform/finance/legacy-atlas-finance.service';
import { InternalAtlasFinanceController } from '../../../presentation/controllers/internal-atlas-finance.controller';
import { InternalBosqueFinanceService } from '../../unified-platform/finance/legacy-bosque-finance.service';
import { InternalBosqueFinanceController } from '../../../presentation/controllers/internal-bosque-finance.controller';
import { InternalRenovadaFinanceService } from '../../unified-platform/finance/legacy-renovada-finance.service';
import { InternalRenovadaFinanceController } from '../../../presentation/controllers/internal-renovada-finance.controller';
import { InternalEbookFinanceService } from '../../unified-platform/finance/legacy-ebook-finance.service';
import { InternalEbookFinanceController } from '../../../presentation/controllers/internal-ebook-finance.controller';
import { InternalPagatgFinanceService } from '../../unified-platform/finance/legacy-pagatg-finance.service';
import { InternalPagatgFinanceController } from '../../../presentation/controllers/internal-pagatg-finance.controller';
import { InternalAreaflixFinanceService } from '../../unified-platform/finance/legacy-areaflix-finance.service';
import { InternalAreaflixFinanceController } from '../../../presentation/controllers/internal-areaflix-finance.controller';
const definitions = [
  ['ATLAS', InternalAtlasFinanceService, InternalAtlasFinanceController],
  ['BOSQUE', InternalBosqueFinanceService, InternalBosqueFinanceController],
  [
    'RENOVADA',
    InternalRenovadaFinanceService,
    InternalRenovadaFinanceController,
  ],
  ['EBOOK', InternalEbookFinanceService, InternalEbookFinanceController],
  ['PAGATG', InternalPagatgFinanceService, InternalPagatgFinanceController],
  [
    'AREAFLIX',
    InternalAreaflixFinanceService,
    InternalAreaflixFinanceController,
  ],
] as const;
beforeEach(async () =>
  initializePlatformTaxasCache({
    platformTaxaOverride: {
      findMany: async () =>
        definitions.flatMap(([tag]) => [
          { tag, key: 'TAXA_SERVICO', value: 4 },
          { tag, key: 'TAXA_FIXA_TRANSACAO', value: 1 },
          { tag, key: 'TAXA_CASHBACK', value: 1 },
          { tag, key: 'SAQUE_MIN', value: 100 },
          { tag, key: 'TAXA_SAQUE_EXTRA', value: 3 },
        ]),
    },
  } as any),
);
afterEach(async () =>
  initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as any),
);
// Evaluate the Prisma predicates instead of returning the same rows for every tenant.

function fixture(tag: string, Service: any, Controller: any) {
  const state = { userExists: true };
  const date = new Date('2026-10-15T12:00:00Z');
  const tx = {
    id: 'tx',
    userId: 'owner',
    amount: new Prisma.Decimal(120),
    netAmount: new Prisma.Decimal(110),
    platformFee: new Prisma.Decimal(7),
    acquirerFee: new Prisma.Decimal(3),
    status: 'COMPLETED',
    description: `[TENANT:${tag}] Buyer`,
    platformTag: tag,
    paymentMethod: 'PIX',
    createdAt: date,
    updatedAt: date,
    domPaymentId: 'provider',
  };
  const txs = [
    tx,
    {
      ...tx,
      id: 'foreign',
      userId: 'owner',
      description: '[TENANT:OTHER] Buyer',
      platformTag: 'OTHER',
    },
  ];
  const withdrawals = ['PENDING', 'COMPLETED'].map((status, i) => ({
    id: `w${i}`,
    userId: 'owner',
    platform: tag.toLowerCase(),
    status,
    amount: new Prisma.Decimal(17),
    grossAmount: new Prisma.Decimal(20),
    fee: new Prisma.Decimal(3),
    pixKey: 'key',
    createdAt: date,
    updatedAt: date,
  }));
  const queries: any[] = [];
  const model = (rows: any[]) => ({
    findMany: async (q: any) => {
      queries.push(q);
      const selected = rows.filter((row) => matches(row, q.where));
      return selected.slice(
        q.skip ?? 0,
        q.take === undefined ? undefined : (q.skip ?? 0) + q.take,
      );
    },
    count: async (q: any) => rows.filter((row) => matches(row, q.where)).length,
    findFirst: async ({ where }: any) =>
      rows.find((row) => matches(row, where)) ?? null,
    findUnique: async ({ where }: any) =>
      rows.find((row) => matches(row, where)) ?? null,
    aggregate: async (q: any) => {
      const selected = rows.filter((row) => matches(row, q.where));
      return {
        _sum: Object.fromEntries(
          Object.keys(q._sum ?? {}).map((key) => [
            key,
            selected.reduce(
              (sum, row) => sum.plus(row[key] ?? 0),
              new Prisma.Decimal(0),
            ),
          ]),
        ),
        _count: selected.length,
      };
    },
  });
  const wallet = {
    balance: new Prisma.Decimal(100),
    lockedBalance: new Prisma.Decimal(10),
  };
  const p: any = {
    user: {
      findMany: async () => (state.userExists ? [{ id: 'owner' }] : []),
      findUnique: async () => (state.userExists ? { id: 'owner' } : null),
    },
    wallet: { findFirst: async () => wallet, findUnique: async () => wallet },
    transaction: model(txs),
    withdrawRequest: model(withdrawals),
    platform: { count: async () => 2 },
  };
  const finance = new PlatformFinanceService(p);
  const service =
    tag === 'EBOOK' || tag === 'PAGATG'
      ? new Service(p, {}, finance)
      : new Service(p, finance);
  return {
    state,
    p,
    queries,
    txs,
    tx,
    service,
    controller: new Controller(service),
    finance,
    withdrawals,
  };
}
for (const [tag, Service, Controller] of definitions) {
  test(`${tag} summary alias characterizes wallet and corporate net projection in reais`, async () => {
    const f = fixture(tag, Service, Controller);
    const summary =
      tag === 'AREAFLIX'
        ? await f.controller.wallet('12345678901')
        : tag === 'ATLAS'
          ? await f.controller.summary('12345678901')
          : await f.controller.summary('12345678901');
    const expected =
      tag === 'BOSQUE' ? 66 : tag === 'EBOOK' ? 66 : tag === 'PAGATG' ? 74 : 90;
    expect(summary.availableBalance).toBe(expected);
    if (tag === 'ATLAS' || tag === 'RENOVADA' || tag === 'AREAFLIX') {
      const canonical = await f.finance.summary({
        id: 'p',
        tag,
        ownerUserId: 'owner',
        acquirer: 'DOM',
      });
      expect(canonical.availableBalanceCents).toBe(
        summary.availableBalance * 100,
      );
      expect(canonical.walletScope).toBe('shared-owner');
    }
  });
  if (tag !== 'ATLAS')
    test(`${tag} withdrawal listing preserves rows, pagination and persisted monetary units`, async () => {
      const f = fixture(tag, Service, Controller);
      const result =
        tag === 'AREAFLIX' || tag === 'EBOOK'
          ? await f.controller.withdrawals('12345678901', '1', '10')
          : await f.controller.withdrawals('12345678901', undefined, '1', '10');
      expect(result.meta.totalItems).toBe(2);
      expect(result.withdrawals[0]).toMatchObject({
        id: 'w0',
        amount: 17,
        status: 'PENDING',
        pixKey: 'key',
      });
      const canonical = await f.finance.withdrawals({
        id: 'p',
        tag,
        ownerUserId: 'owner',
        acquirer: 'DOM',
      });
      expect(canonical.data[0].amountCents).toBe(
        result.withdrawals[0].amount * 100,
      );
      expect(canonical.meta.total).toBe(result.meta.totalItems);
    });
  if (['BOSQUE', 'RENOVADA', 'EBOOK', 'PAGATG'].includes(tag))
    test(`${tag} transactions preserve fee projection and exclude other products under description filter`, async () => {
      const f = fixture(tag, Service, Controller);
      const result =
        tag === 'EBOOK'
          ? await f.controller.transactions(
              '12345678901',
              '1',
              '10',
              undefined,
              undefined,
              'COMPLETED',
              'Buyer',
            )
          : await f.controller.transactions(
              '12345678901',
              undefined,
              '1',
              '10',
              undefined,
              undefined,
              'COMPLETED',
              'Buyer',
            );
      expect(result.meta.totalItems).toBe(1);
      expect(result.transactions[0]).toMatchObject({
        id: 'tx',
        amount: 120,
        fee: 7,
        dom_fee: 3,
        amountWithoutAllFee: tag === 'PAGATG' ? 108 : 106,
      });
      const canonical = await f.finance.transactions({
        id: 'p',
        tag,
        ownerUserId: 'owner',
        acquirer: 'DOM',
      });
      expect(canonical.data[0]).toMatchObject({
        id: 'tx',
        amountCents: 12000,
        netAmountCents: 11000,
        platformFeeCents: 700,
        acquirerFeeCents: 300,
      });
    });
}
test('AreaFlix status and withdrawal totals preserve fee/minimum and pending/completed units', async () => {
  const f = fixture(
    'AREAFLIX',
    InternalAreaflixFinanceService,
    InternalAreaflixFinanceController,
  );
  expect(await f.controller.accountStatus('12345678901')).toEqual({
    accountExists: true,
    minimumWithdrawalAmount: 100,
    withdrawalFeeBrl: 3,
  });
  expect(await f.controller.withdrawalTotals('12345678901')).toEqual({
    pendingGross: 20,
    completedGross: 20,
  });
});
test('Atlas health and withdrawal status preserve nonfinancial contract and not-found error', async () => {
  const f = fixture(
    'ATLAS',
    InternalAtlasFinanceService,
    InternalAtlasFinanceController,
  );
  expect(await f.controller.health()).toEqual({
    status: 'ok',
    service: 'atlas-finance-internal',
  });
  expect(await f.controller.getWithdrawStatus('w0')).toMatchObject({
    id: 'w0',
    status: 'PENDING',
  });
  const canonical = await f.finance.withdrawal(
    { id: 'p', tag: 'ATLAS', ownerUserId: 'owner', acquirer: 'DOM' },
    'w0',
  );
  expect(canonical).toMatchObject({
    id: 'w0',
    amountCents: 1700,
    grossAmountCents: 2000,
    feeCents: 300,
    status: 'PENDING',
  });
  await expect(
    f.finance.withdrawal(
      { id: 'p', tag: 'OTHER', ownerUserId: 'owner', acquirer: 'DOM' },
      'w0',
    ),
  ).rejects.toThrow('Saque não encontrado');
  await expect(f.controller.getWithdrawStatus('missing')).rejects.toThrow(
    'Saque não encontrado',
  );
});
test('Ebook configuration preserves decimal liquidity and legacy percentage commission', () => {
  const f = fixture(
    'EBOOK',
    InternalEbookFinanceService,
    InternalEbookFinanceController,
  );
  const legacy = f.controller.getConfig();
  expect(legacy).toMatchObject({
    transactionFeeBrl: 4,
    taxaFixaTransacao: 1,
    taxaCashback: 1,
  });
  expect(
    f.finance.config({
      id: 'p',
      tag: 'EBOOK',
      ownerUserId: 'owner',
      acquirer: 'DOM',
    }),
  ).toEqual({
    unit: 'cents',
    liquidityRate: legacy.liquidez,
    pixMdrRate: legacy.mdrPix,
    transactionFeeCents: 400,
    fixedTransactionFeeCents: 100,
    cashbackAmountCents: 100,
    affiliateCommissionRate: legacy.affiliateCommissionRate / 100,
    withdrawal: expect.objectContaining({ percentFee: 0 }),
  });
});
test('Bosque inspection and read-only reconciliation preserve wallet and ledger decomposition', async () => {
  const f = fixture(
    'BOSQUE',
    InternalBosqueFinanceService,
    InternalBosqueFinanceController,
  );
  expect(await f.controller.inspectWallet('owner')).toMatchObject({
    accountExists: true,
    balance: 100,
    lockedBalance: 10,
    availableBalance: 90,
  });
  const result = await f.controller.reconcile('owner');
  expect(result.current).toEqual({
    balance: 100,
    lockedBalance: 10,
    availableBalance: 90,
  });
  expect(result.credits).toMatchObject({
    completedCount: 1,
    grossCredits: 120,
    netCredits: 110,
  });
  expect(result.withdrawals).toEqual({ approvedGross: 20, pendingGross: 20 });
  expect(result.suggested.net).toEqual({ balance: 90, availableBalance: 70 });
});
