import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { ApproveWithdrawalUseCase } from '../src/application/use-cases/admin/approve-withdrawal.use-case';
import { RejectWithdrawalUseCase } from '../src/application/use-cases/admin/reject-withdrawal.use-case';
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
