import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient, type TransactionStatus } from '@prisma/client';
import { Client } from 'pg';
import { AffiliateCommissionService } from '../src/application/services/affiliate-commission.service';
import { ApproveWithdrawalUseCase } from '../src/application/use-cases/admin/approve-withdrawal.use-case';
import { RejectWithdrawalUseCase } from '../src/application/use-cases/admin/reject-withdrawal.use-case';
import { ProcessDomWebhookUseCase } from '../src/application/use-cases/webhook/process-dom-webhook.use-case';
import { ProcessWebhookUseCase } from '../src/application/use-cases/webhook/process-webhook.use-case';
import { settleFinalNet } from '../src/modules/platform-core/link-settlement';
import { PlatformLinkClaim } from '../src/modules/platform-core/platform-link-claim';
import { PlatformFinanceService } from '../src/modules/unified-platform/finance/platform-finance.service';
import { initializePlatformTaxasCache } from '../src/modules/platform-taxas/platform-taxas.store';
import {
  InsufficientWithdrawBalanceError,
  PrismaWithdrawRepository,
} from '../src/infrastructure/database/repositories/prisma-withdraw.repository';

// Local disposable Postgres only (COPRODUCTION_TEST_DATABASE_URL, db push applied). Every scenario
// asserts the invariant Wallet == SUM(BalanceLog) after a writer that now only inserts log rows.
const url = process.env.COPRODUCTION_TEST_DATABASE_URL;
if (
  url &&
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)
) {
  throw new Error('Tests require a local isolated database');
}
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const migrationSql = readFileSync(
  resolve(
    import.meta.dir,
    '../prisma/migrations/20261031130000_balance_log_drives_wallet/migration.sql',
  ),
  'utf8',
);
const guardRe =
  /-- wallet-ledger-divergence-guard:begin[\s\S]*?-- wallet-ledger-divergence-guard:end/;

beforeAll(async () => {
  if (!url) return;
  const pg = new Client({ connectionString: url });
  await pg.connect();
  try {
    await pg.query(migrationSql.replace(guardRe, ''));
  } finally {
    await pg.end();
  }
  await initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as never);
});
afterAll(async () => {
  await db?.$disconnect();
});
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 60000);

const noopRealtime = { notifyWithdrawal: async () => undefined } as never;
const prismaService = db as never;

const newUser = (extra: Record<string, unknown> = {}) =>
  db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Writer',
      password: 'x',
      role: 'USER',
      ...extra,
    },
  });
const fund = (userId: string, balanceDelta: string, lockedDelta = '0') =>
  db!.balanceLog.create({
    data: {
      userId,
      action: 'SEED',
      source: 'TEST',
      balanceDelta,
      lockedDelta,
    },
  });
/** Asserts Wallet == SUM(BalanceLog) and returns [balance, locked]. */
const expectConsistent = async (userId: string) => {
  const w = await db!.wallet.findUniqueOrThrow({ where: { userId } });
  const sums = await db!.balanceLog.aggregate({
    where: { userId },
    _sum: { balanceDelta: true, lockedDelta: true },
  });
  expect(w.balance.toFixed(2)).toBe(
    (sums._sum.balanceDelta ?? 0).toString() === '0'
      ? '0.00'
      : sums._sum.balanceDelta!.toFixed(2),
  );
  expect(w.lockedBalance.toFixed(2)).toBe(
    (sums._sum.lockedDelta ?? 0).toString() === '0'
      ? '0.00'
      : sums._sum.lockedDelta!.toFixed(2),
  );
  return [w.balance.toFixed(2), w.lockedBalance.toFixed(2)];
};

const requestInput = (userId: string, gross: number) => ({
  userId,
  amount: gross - 2,
  grossAmount: gross,
  fee: 2,
  pixKey: 'pix@local.test',
  platform: null,
  amountToLock: gross,
});

// --- withdrawals -------------------------------------------------------------------------------

run('withdrawal request locks funds through the log only', async () => {
  const user = await newUser();
  await fund(user.id, '100');
  const repo = new PrismaWithdrawRepository(prismaService);
  const created = await repo.createWithWalletLock(requestInput(user.id, 60));
  expect(created.remainingBalanceAfterWithdrawal?.toFixed(2)).toBe('40.00');
  expect(await expectConsistent(user.id)).toEqual(['100.00', '60.00']);
});

run('two concurrent withdrawal requests cannot overdraw', async () => {
  const user = await newUser();
  await fund(user.id, '100');
  const repo = new PrismaWithdrawRepository(prismaService);
  const results = await Promise.allSettled([
    repo.createWithWalletLock(requestInput(user.id, 80)),
    repo.createWithWalletLock(requestInput(user.id, 80)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected') as
    PromiseRejectedResult | undefined;
  expect(rejected?.reason).toBeInstanceOf(InsufficientWithdrawBalanceError);
  expect(await expectConsistent(user.id)).toEqual(['100.00', '80.00']);
  expect(await db!.withdrawRequest.count({ where: { userId: user.id } })).toBe(
    1,
  );
});

run('approval debits balance and locked once; reject releases', async () => {
  const user = await newUser();
  await fund(user.id, '100');
  const repo = new PrismaWithdrawRepository(prismaService);
  const approve = new ApproveWithdrawalUseCase(prismaService, noopRealtime);
  const reject = new RejectWithdrawalUseCase(prismaService, noopRealtime);

  const first = await repo.createWithWalletLock(requestInput(user.id, 30));
  await approve.execute(first.id);
  expect(await expectConsistent(user.id)).toEqual(['70.00', '0.00']);
  // Frozen available balance comes from the wallet the trigger just updated.
  const approved = await db!.withdrawRequest.findUniqueOrThrow({
    where: { id: first.id },
  });
  expect(approved.remainingBalanceAfterWithdrawal?.toFixed(2)).toBe('70.00');

  const second = await repo.createWithWalletLock(requestInput(user.id, 20));
  expect(await expectConsistent(user.id)).toEqual(['70.00', '20.00']);
  await reject.execute(second.id, 'no');
  expect(await expectConsistent(user.id)).toEqual(['70.00', '0.00']);

  // Double-submitted reject is a no-op, approve returns early; nothing moves.
  await reject.execute(second.id, 'again');
  await approve.execute(first.id);
  expect(await expectConsistent(user.id)).toEqual(['70.00', '0.00']);
});

// --- webhooks ----------------------------------------------------------------------------------

const newPendingTx = async (userId: string, netAmount: string) =>
  db!.transaction.create({
    data: {
      // 64-hex ids use the persisted net amount instead of the legacy fee formula.
      id: (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', ''),
      userId,
      amount: '100',
      netAmount,
      status: 'PENDING',
      description: '[TENANT:CLIENT]',
      domPaymentId: 'a'.repeat(32) + crypto.randomUUID().replaceAll('-', ''),
    },
  });

const buildWebhookUseCase = () => {
  const seen = new Set<string>();
  const events = {
    findByEventId: async (id: string) =>
      seen.has(id) ? { id, status: 'PROCESSED' } : null,
    create: async () => ({ id: crypto.randomUUID() }),
    markProcessed: async (_id: string) => undefined,
    markFailed: async () => undefined,
  };
  const transactions = {
    findByDomPaymentId: (domPaymentId: string) =>
      db!.transaction.findUnique({ where: { domPaymentId } }),
  };
  const affiliates = {
    applyForTransaction: async () => undefined,
    reverseForTransaction: async () => undefined,
  };
  return new ProcessWebhookUseCase(
    events as never,
    transactions as never,
    {} as never,
    prismaService,
    {} as never,
    affiliates as never,
  );
};

run(
  'canonical webhook credits once even when delivered concurrently',
  async () => {
    const user = await newUser();
    await fund(user.id, '10');
    const tx = await newPendingTx(user.id, '90');
    const uc = buildWebhookUseCase();
    const paid = (signature: string) => ({
      payload: {
        event: 'transaction',
        signature,
        data: {
          paymentId: tx.domPaymentId,
          status: 'paid',
          amountWithoutAllFee: 90,
        },
      },
    });
    await Promise.all([uc.execute(paid('s1')), uc.execute(paid('s2'))]);
    await uc.execute(paid('s3'));
    expect(await expectConsistent(user.id)).toEqual(['100.00', '0.00']);

    // Refund reverses exactly what was credited, once.
    const refunded = (signature: string) => ({
      payload: {
        event: 'transaction',
        signature,
        data: {
          paymentId: tx.domPaymentId,
          status: 'refunded',
          amountWithoutAllFee: 90,
        },
      },
    });
    await Promise.all([uc.execute(refunded('r1')), uc.execute(refunded('r2'))]);
    expect(await expectConsistent(user.id)).toEqual(['10.00', '0.00']);
  },
);

run(
  'DOM webhook credits once, then reverses once, under concurrency',
  async () => {
    const user = await newUser();
    await fund(user.id, '5');
    const tx = await newPendingTx(user.id, '90');
    const uc = new ProcessDomWebhookUseCase(
      prismaService,
      { recordUsage: async () => undefined } as never,
      {
        applyForTransaction: async () => undefined,
        reverseForTransaction: async () => undefined,
      } as never,
    );
    const send = (signature: string, status: string) =>
      uc.execute({
        event: 'charge',
        signature: `${tx.id}-${signature}`,
        data: { id: tx.domPaymentId, amount: 10000, status },
      });
    await Promise.all([send('d1', 'paid'), send('d2', 'paid')]);
    await send('d3', 'paid');
    const credited = await expectConsistent(user.id);
    expect(credited[1]).toBe('0.00');
    const afterCredit = new Prisma.Decimal(credited[0]).sub(5);
    expect(afterCredit.gt(0)).toBe(true);
    const logs = await db!.balanceLog.findMany({
      where: { userId: user.id, transactionId: tx.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].balanceDelta.toFixed(2)).toBe(afterCredit.toFixed(2));

    await Promise.all([send('d4', 'refunded'), send('d5', 'refunded')]);
    expect(await expectConsistent(user.id)).toEqual(['5.00', '0.00']);
  },
);

// --- affiliate commission, link settlement, platform withdrawals, link claim --------------------

run(
  'affiliate commission credit and reversal are idempotent and sum-consistent',
  async () => {
    const affiliate = await newUser({
      isAffiliate: true,
      affiliateCommissionPercent: '20',
    });
    await fund(affiliate.id, '50');
    const referred = await newUser({ referredByUserId: affiliate.id });
    const tx = await newPendingTx(referred.id, '90');
    const svc = new AffiliateCommissionService();
    const apply = () =>
      db!.$transaction((p) =>
        svc.applyForTransaction(p, {
          transactionId: tx.id,
          referredUserId: referred.id,
          platformFee: 10,
        }),
      );
    await Promise.allSettled([apply(), apply()]);
    await apply();
    expect(await expectConsistent(affiliate.id)).toEqual(['52.00', '0.00']);
    const reverse = () =>
      db!.$transaction((p) => svc.reverseForTransaction(p, tx.id));
    await Promise.allSettled([reverse(), reverse()]);
    await reverse();
    expect(await expectConsistent(affiliate.id)).toEqual(['50.00', '0.00']);
  },
);

run(
  'settleFinalNet credits, mediates and refunds through the log only',
  async () => {
    const user = await newUser();
    await fund(user.id, '10');
    const tx = await db!.transaction.create({
      data: {
        userId: user.id,
        amount: '100',
        netAmount: '87',
        settlementBasis: 'FINAL_NET',
        status: 'PENDING',
        domPaymentId: crypto.randomUUID(),
      },
    });
    const settle = (status: TransactionStatus) =>
      db!.$transaction(async (p) =>
        settleFinalNet(
          p,
          await p.transaction.findUniqueOrThrow({ where: { id: tx.id } }),
          status,
          'WEBHOOK',
        ),
      );
    const results = await Promise.allSettled([
      settle('COMPLETED'),
      settle('COMPLETED'),
    ]);
    expect(
      results.filter((r) => r.status === 'fulfilled' && r.value),
    ).toHaveLength(1);
    expect(await expectConsistent(user.id)).toEqual(['97.00', '0.00']);
    await settle('IN_MEDIATION');
    expect(await expectConsistent(user.id)).toEqual(['10.00', '87.00']);
    await settle('REFUNDED');
    expect(await expectConsistent(user.id)).toEqual(['10.00', '0.00']);
  },
);

const newPlatform = async (ownerUserId: string, tag: string) =>
  db!.platform.create({
    data: { tag, name: tag, ownerUserId },
  });

run(
  'platform withdrawal reservation cannot overdraw under concurrency',
  async () => {
    const owner = await newUser();
    await fund(owner.id, '100');
    const tag = `SHOP${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await newPlatform(owner.id, tag);
    const service = new PlatformFinanceService(prismaService);
    const request = () =>
      service.createWithdrawal({
        userId: owner.id,
        platform: tag,
        amount: 78,
        grossAmount: 80,
        fee: 2,
        pixKey: 'k',
        reserveWallet: true,
      });
    const results = await Promise.allSettled([request(), request()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await expectConsistent(owner.id)).toEqual(['100.00', '80.00']);
  },
);

run('link claim moves the balance once through the logs', async () => {
  const source = await newUser();
  const target = await newUser();
  await fund(source.id, '100');
  await db!.platform.deleteMany({ where: { tag: 'AREAFLIX' } });
  const platform = await newPlatform(target.id, 'AREAFLIX');
  await db!.platformIntegration.create({
    data: {
      platformId: platform.id,
      key: 'CLAIM_SOURCE_USER_ID',
      url: source.id,
    },
  });
  const claim = new PlatformLinkClaim(prismaService);
  const run1 = () =>
    claim.claim('AREAFLIX', target.id, { retroactiveAmountCents: 4000 });
  await Promise.allSettled([run1(), run1()]);
  await run1();
  expect(await expectConsistent(source.id)).toEqual(['60.00', '0.00']);
  expect(await expectConsistent(target.id)).toEqual(['40.00', '0.00']);
});
