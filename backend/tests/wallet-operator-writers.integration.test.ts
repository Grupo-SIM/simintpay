import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { PrismaWithdrawRepository } from '../src/infrastructure/database/repositories/prisma-withdraw.repository';
import { initializePlatformRegistryCache } from '../src/modules/module.registry';
import { initializePlatformTaxasCache } from '../src/modules/platform-taxas/platform-taxas.store';
import { PlatformMaintenanceService } from '../src/modules/unified-platform/finance/platform-maintenance.service';
import { applyWalletEntry } from '../src/modules/wallet-ledger/wallet-ledger';
import { ApproveWithdrawalUseCase } from '../src/application/use-cases/admin/approve-withdrawal.use-case';
import { PlatformOwnerMirror } from '../src/modules/platform-core/platform-owner-mirror';
import { AdminController } from '../src/presentation/controllers/admin.controller';

// Batch B (operator/maintenance writers). Local disposable Postgres only
// (COPRODUCTION_TEST_DATABASE_URL, db push applied). Every scenario asserts Wallet == SUM(BalanceLog)
// after an operator tool that now only inserts log rows.
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

const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 60000);
const prismaService = db as never;

/** Admin controller restricted to the prisma-only code paths exercised here. */
const controller = (): any => {
  const c = Object.create(AdminController.prototype);
  c.prisma = db;
  return c;
};

const newUser = (extra: Record<string, unknown> = {}) =>
  db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Operator target',
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
    new Prisma.Decimal(sums._sum.balanceDelta ?? 0).toFixed(2),
  );
  expect(w.lockedBalance.toFixed(2)).toBe(
    new Prisma.Decimal(sums._sum.lockedDelta ?? 0).toFixed(2),
  );
  return [w.balance.toFixed(2), w.lockedBalance.toFixed(2)];
};
/** Exclusive platform (one owner, one tag) so the maintenance guards pass. */
const newPlatform = async (tag: string) => {
  const owner = await newUser({ isCompany: true });
  await db!.platform.deleteMany({ where: { tag } }); // reruns on a reused database
  const platform = await db!.platform.create({
    data: { tag, name: tag, ownerUserId: owner.id },
  });
  await initializePlatformRegistryCache(db as never);
  return { owner, platform };
};

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

// --- bulk withdrawal completion ---------------------------------------------------------------

run(
  'bulk completion debits a pending withdrawal once, even if submitted twice',
  async () => {
    const user = await newUser();
    await fund(user.id, '100');
    await new PrismaWithdrawRepository(prismaService).createWithWalletLock({
      userId: user.id,
      amount: 58,
      grossAmount: 60,
      fee: 2,
      pixKey: 'pix@local.test',
      platform: null,
      amountToLock: 60,
    });
    expect(await expectConsistent(user.id)).toEqual(['100.00', '60.00']);
    await controller().approveAllWithdrawals();
    expect(await expectConsistent(user.id)).toEqual(['40.00', '0.00']);
    await controller().approveAllWithdrawals();
    expect(await expectConsistent(user.id)).toEqual(['40.00', '0.00']);
  },
);

// --- purge of a direct account -----------------------------------------------------------------

run(
  'purge absorbs balance and locked through the log; second purge is rejected',
  async () => {
    const user = await newUser();
    await fund(user.id, '100', '10');
    const result = await controller().purgeContaDireta(user.id, 'master');
    expect(result.saldoAbsorvido).toBe(100);
    expect(await expectConsistent(user.id)).toEqual(['0.00', '0.00']);
    const purged = await db!.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(purged.isPurged).toBe(true);
    expect(purged.purgedAmount?.toFixed(2)).toBe('100.00');
    await expect(controller().purgeContaDireta(user.id)).rejects.toThrow();
    expect(await expectConsistent(user.id)).toEqual(['0.00', '0.00']);
  },
);

// --- charge debit -------------------------------------------------------------------------------

run(
  'charge debit may go negative and two submissions debit twice',
  async () => {
    const user = await newUser({ isCompany: true });
    await fund(user.id, '50');
    const body = { itens: [{ userId: user.id, amount: 80 }] };
    const first = await controller().debitarCobrancas(body, { sub: 'master' });
    expect(first.resultados[0]).toMatchObject({
      ok: true,
      ficouNegativo: true,
    });
    expect(await expectConsistent(user.id)).toEqual(['-30.00', '0.00']);
    await controller().debitarCobrancas(body, { sub: 'master' });
    expect(await expectConsistent(user.id)).toEqual(['-110.00', '0.00']);
    expect(await db!.cobranca.count({ where: { userId: user.id } })).toBe(2);
  },
);

// --- cleanup (wallet reset with a log row) -----------------------------------------------------

run(
  'cleanup reset zeroes the wallet through a log row and is idempotent',
  async () => {
    const user = await newUser();
    await fund(user.id, '75', '5');
    await controller().zeroWalletWithLog(user.id, 'test');
    expect(await expectConsistent(user.id)).toEqual(['0.00', '0.00']);
    await controller().zeroWalletWithLog(user.id, 'test');
    expect(
      await db!.balanceLog.count({
        where: { userId: user.id, action: 'WALLET_RESET_FINAL' },
      }),
    ).toBe(1);
  },
);

// --- Renovada absolute set (controller, real platform registry) --------------------------------

run(
  'absolute set logs the difference; resubmission and a concurrent credit stay consistent',
  async () => {
    const { owner } = await newPlatform('RENOVADA');
    await fund(owner.id, '30');
    const c = controller();
    await c.syncWalletRenovada('100');
    const [balance] = await expectConsistent(owner.id);
    const set = Number(balance);
    expect(set).toBeGreaterThan(0);
    await c.syncWalletRenovada('100');
    expect(await expectConsistent(owner.id)).toEqual([balance, '0.00']);

    // A webhook-style credit racing the operator set: whichever commits first, the sums must close.
    await Promise.all([
      c.syncWalletRenovada('200'),
      db!.$transaction((tx) =>
        applyWalletEntry(tx, {
          userId: owner.id,
          action: 'DOM_WEBHOOK_COMPLETED',
          source: 'DOM_WEBHOOK',
          balanceDelta: 50,
        }),
      ),
    ]);
    const [after] = await expectConsistent(owner.id);
    const logs = await db!.balanceLog.findMany({
      where: { userId: owner.id, action: 'WALLET_RECALCULATE' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.length).toBe(3);
    const gross = new Prisma.Decimal(
      (logs[2].metadata as { grossBalance: number }).grossBalance,
    ).toDecimalPlaces(2);
    // set-then-credit keeps the credit (gross + 50); credit-then-set overwrites it (gross).
    expect([gross.toFixed(2), gross.plus(50).toFixed(2)]).toContain(after);
  },
);

// --- platform-maintenance service ---------------------------------------------------------------

run(
  'maintenance correct sets absolute balance as a log difference, repeatably',
  async () => {
    const { owner, platform } = await newPlatform(
      `M${crypto.randomUUID().slice(0, 8)}`,
    );
    await fund(owner.id, '100', '10');
    const service = new PlatformMaintenanceService(prismaService);
    const first = await service.correct(owner.id, platform.tag, {
      balance: 70,
      reason: 'test',
    });
    expect(first.changed).toBe(true);
    expect(await expectConsistent(owner.id)).toEqual(['70.00', '10.00']);
    const second = await service.correct(owner.id, platform.tag, {
      balance: 70,
      reason: 'test',
    });
    expect(second.changed).toBe(false);
    await service.correct(owner.id, platform.tag, {
      delta: -20,
      reason: 'test',
    });
    await service.correct(owner.id, platform.tag, {
      balance: 0,
      lockedBalance: 0,
      reason: 'zero',
    });
    expect(await expectConsistent(owner.id)).toEqual(['0.00', '0.00']);
  },
);

run('maintenance correct racing a credit never loses the credit', async () => {
  const { owner, platform } = await newPlatform(
    `M${crypto.randomUUID().slice(0, 8)}`,
  );
  await fund(owner.id, '100');
  const service = new PlatformMaintenanceService(prismaService);
  const results = await Promise.allSettled([
    service.correct(owner.id, platform.tag, { balance: 40, reason: 'race' }),
    db!.$transaction((tx) =>
      applyWalletEntry(tx, {
        userId: owner.id,
        action: 'DOM_WEBHOOK_COMPLETED',
        source: 'DOM_WEBHOOK',
        balanceDelta: 25,
      }),
    ),
  ]);
  // The Serializable correction may be rejected for a retry; it must never corrupt the sums.
  const [balance] = await expectConsistent(owner.id);
  const correctOk = results[0].status === 'fulfilled';
  expect(results[1].status).toBe('fulfilled');
  // set-then-credit = 65, credit-then-set = 40, correction rejected = 125.
  expect([correctOk ? '40.00' : '125.00', '65.00']).toContain(balance);
});

run(
  'ordinary withdrawal approval never debits legacy balances and repeated approval is idempotent',
  async () => {
    const user = await newUser();
    await fund(user.id, '100');
    const external = await db!.externalPlatformUser.create({
      data: {
        name: user.name,
        userId: user.id,
        platform: 'ebook',
        wallet: { create: { balance: 77, lockedBalance: 9 } },
      },
      include: { wallet: true },
    });
    const withdrawal = await new PrismaWithdrawRepository(
      prismaService,
    ).createWithWalletLock({
      userId: user.id,
      amount: 58,
      grossAmount: 60,
      fee: 2,
      pixKey: 'local@test',
      platform: null,
      amountToLock: 60,
    });
    const useCase = new ApproveWithdrawalUseCase(prismaService, {
      notifyWithdrawal: async () => {},
    } as any);
    await useCase.execute(withdrawal.id);
    await useCase.execute(withdrawal.id);
    expect(await expectConsistent(user.id)).toEqual(['40.00', '0.00']);
    const wallet = await db!.externalPlatformWallet.findUniqueOrThrow({
      where: { externalUserId: external.id },
    });
    expect(wallet.balance.toFixed(2)).toBe('77.00');
    expect(wallet.lockedBalance.toFixed(2)).toBe('9.00');
    expect(
      await db!.balanceLog.count({
        where: { userId: user.id, action: 'WITHDRAW_APPROVED' },
      }),
    ).toBe(1);
  },
);

run(
  'owner compatibility reads pooled Wallet without copying or inventing platform balances',
  async () => {
    const user = await newUser();
    await fund(user.id, '100');
    const tag = `test-${crypto.randomUUID()}`;
    await db!.platform.create({
      data: { name: tag, tag, ownerUserId: user.id },
    });
    const external = await db!.externalPlatformUser.create({
      data: {
        name: user.name,
        userId: user.id,
        platform: tag,
        wallet: { create: { balance: 77 } },
      },
    });
    const before = await db!.balanceLog.count({ where: { userId: user.id } });
    const mirror = new PlatformOwnerMirror(prismaService);
    for (let i = 0; i < 2; i++) {
      expect(await mirror.sync(tag)).toMatchObject({
        success: true,
        balance: 100,
        balanceScope: 'USER_WALLET_AGGREGATE',
        platformBalanceKnown: false,
      });
    }
    expect(
      (
        await db!.externalPlatformWallet.findUniqueOrThrow({
          where: { externalUserId: external.id },
        })
      ).balance.toFixed(2),
    ).toBe('77.00');
    expect(await db!.balanceLog.count({ where: { userId: user.id } })).toBe(
      before,
    );
  },
);

run(
  'external purge quarantines positive negative and locked historical liabilities without master credit',
  async () => {
    for (const [balance, lockedBalance] of [
      [77, 0],
      [-3, 0],
      [0, 9],
    ]) {
      const user = await newUser();
      const external = await db!.externalPlatformUser.create({
        data: {
          name: user.name,
          userId: user.id,
          platform: 'ebook',
          isDeleted: true,
          wallet: { create: { balance, lockedBalance } },
        },
      });
      const before = await db!.balanceLog.count();
      await expect(controller().purgeExternalUser(external.id)).rejects.toThrow(
        'Saldo externo não reconciliado',
      );
      expect(await db!.balanceLog.count()).toBe(before);
      expect(
        (
          await db!.externalPlatformUser.findUniqueOrThrow({
            where: { id: external.id },
          })
        ).isPurged,
      ).toBe(false);
      const wallet = await db!.externalPlatformWallet.findUniqueOrThrow({
        where: { externalUserId: external.id },
      });
      expect(Number(wallet.balance)).toBe(balance);
      expect(Number(wallet.lockedBalance)).toBe(lockedBalance);
    }
  },
);
