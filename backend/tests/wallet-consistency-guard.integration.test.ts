import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { assertWalletLedgerConsistency } from '../src/modules/wallet-ledger/wallet-ledger';
import { ApproveWithdrawalUseCase } from '../src/application/use-cases/admin/approve-withdrawal.use-case';
import { RejectWithdrawalUseCase } from '../src/application/use-cases/admin/reject-withdrawal.use-case';
import { PrismaWithdrawRepository } from '../src/infrastructure/database/repositories/prisma-withdraw.repository';
import type { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';

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
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 30000);
const user = () =>
  db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Guard',
      password: 'x',
      role: 'USER',
    },
  });
const entry = (userId: string, balanceDelta = '100', lockedDelta = '0') =>
  db!.balanceLog.create({
    data: { userId, action: 'TEST', source: 'TEST', balanceDelta, lockedDelta },
  });
beforeAll(async () => {
  if (!url) return;
  const pg = new Client({ connectionString: url });
  await pg.connect();
  try {
    const installed = await pg.query(
      "SELECT to_regprocedure('wallet_assert_ledger_consistency(text)') AS guard",
    );
    if (installed.rows[0].guard) return;
    for (const migration of [
      '20261031130000_balance_log_drives_wallet',
      '20261101090000_wallet_consistency_guard',
    ]) {
      let sql = readFileSync(
        resolve(
          import.meta.dir,
          `../prisma/migrations/${migration}/migration.sql`,
        ),
        'utf8',
      );
      sql = sql.replace(
        /-- wallet-ledger-divergence-guard:begin[\s\S]*?-- wallet-ledger-divergence-guard:end/,
        '',
      );
      if (migration === '20261101090000_wallet_consistency_guard') {
        const drift = await user();
        await db!.wallet.create({
          data: { userId: drift.id, balance: 1, lockedBalance: 0 },
        });
        await expect(pg.query(sql)).rejects.toThrow(
          /Existing Wallet ledger inconsistency/,
        );
        await pg.query('ROLLBACK');
        expect(
          (
            await pg.query(
              "SELECT to_regprocedure('wallet_assert_ledger_consistency(text)') AS guard",
            )
          ).rows[0].guard,
        ).toBeNull();
        await db!.wallet.delete({ where: { userId: drift.id } });
        const missing = await user();
        await entry(missing.id);
        await db!.wallet.delete({ where: { userId: missing.id } });
        await expect(pg.query(sql)).rejects.toThrow(
          /Existing Wallet ledger inconsistency/,
        );
        await pg.query('ROLLBACK');
        expect(
          (
            await pg.query(
              "SELECT to_regprocedure('wallet_assert_ledger_consistency(text)') AS guard",
            )
          ).rows[0].guard,
        ).toBeNull();
        await db!.balanceLog.deleteMany({ where: { userId: missing.id } });
      }
      await pg.query(sql);
    }
  } finally {
    await pg.end();
  }
});
afterAll(async () => {
  await db?.$disconnect();
});

run('commit rejects direct balance and locked tampering', async () => {
  const u = await user();
  await entry(u.id);
  for (const data of [{ balance: '101' }, { lockedBalance: '1' }]) {
    await expect(
      db!.$transaction(async (tx) => {
        await tx.wallet.update({ where: { userId: u.id }, data });
        // Deferred: statement succeeds, commit fails.
        expect(await tx.wallet.count({ where: { userId: u.id } })).toBe(1);
      }),
    ).rejects.toThrow(/inconsistency/);
  }
});
run(
  'final state permits transient mismatch and zero provisioning',
  async () => {
    const u = await user();
    await db!.wallet.create({
      data: { userId: u.id, balance: 0, lockedBalance: 0 },
    });
    await db!.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: u.id },
        data: { balance: 20 },
      });
      await tx.balanceLog.create({
        data: {
          userId: u.id,
          action: 'TEST',
          source: 'TEST',
          balanceDelta: 20,
          lockedDelta: 0,
        },
      });
    });
  },
);
run(
  'mutable ledger corrections require same-transaction cache restoration',
  async () => {
    const u = await user();
    const log = await entry(u.id);
    await expect(
      Promise.resolve(
        db!.balanceLog.update({
          where: { id: log.id },
          data: { balanceDelta: 25 },
        }),
      ),
    ).rejects.toThrow(/inconsistency/);
    await db!.$transaction(async (tx) => {
      await tx.balanceLog.update({
        where: { id: log.id },
        data: { balanceDelta: 25 },
      });
      await tx.wallet.update({
        where: { userId: u.id },
        data: { balance: 25 },
      });
    });
    await expect(
      Promise.resolve(db!.balanceLog.delete({ where: { id: log.id } })),
    ).rejects.toThrow(/inconsistency/);
    await db!.$transaction(async (tx) => {
      await tx.balanceLog.delete({ where: { id: log.id } });
      await tx.wallet.update({ where: { userId: u.id }, data: { balance: 0 } });
    });
  },
);
run('moving a ledger entry validates both beneficiaries', async () => {
  const a = await user();
  const b = await user();
  const log = await entry(a.id);
  await db!.wallet.create({
    data: { userId: b.id, balance: 0, lockedBalance: 0 },
  });
  await expect(
    db!.$transaction(async (tx) => {
      await tx.balanceLog.update({
        where: { id: log.id },
        data: { userId: b.id },
      });
      await tx.wallet.update({
        where: { userId: b.id },
        data: { balance: 100 },
      });
    }),
  ).rejects.toThrow(/inconsistency/);
});
run(
  'user deletion with ledger and wallet removal checks final absence',
  async () => {
    const u = await user();
    await entry(u.id);
    await db!.$transaction(async (tx) => {
      await tx.balanceLog.deleteMany({ where: { userId: u.id } });
      await tx.wallet.delete({ where: { userId: u.id } });
      await tx.user.delete({ where: { id: u.id } });
    });
  },
);
run(
  'under-lock assertion refuses even temporarily inconsistent withdrawal state',
  async () => {
    const u = await user();
    await entry(u.id);
    await expect(
      db!.$transaction(async (tx) => {
        await tx.wallet.update({
          where: { userId: u.id },
          data: { balance: 200 },
        });
        await assertWalletLedgerConsistency(tx, u.id);
      }),
    ).rejects.toThrow(/inconsistency/);
  },
);
run(
  'concurrent inserts provision once and retain every ledger delta',
  async () => {
    const u = await user();
    await Promise.all([
      entry(u.id, '10'),
      entry(u.id, '20'),
      entry(u.id, '30'),
    ]);
    expect(
      (
        await db!.wallet.findUniqueOrThrow({ where: { userId: u.id } })
      ).balance.toFixed(2),
    ).toBe('60.00');
  },
);
run('moving Wallet ownership cannot orphan the old beneficiary', async () => {
  const a = await user();
  const b = await user();
  await entry(a.id);
  await expect(
    db!.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: a.id },
        data: { userId: b.id, balance: 0 },
      });
    }),
  ).rejects.toThrow(/inconsistency/);
});
run(
  'approval and rejection claim the withdrawal before locking its Wallet',
  async () => {
    const u = await user();
    await entry(u.id, '100', '80');
    const withdrawal = await db!.withdrawRequest.create({
      data: {
        userId: u.id,
        amount: 80,
        grossAmount: 80,
        fee: 0,
        pixKey: 'local',
        status: 'PENDING',
      },
    });
    const events: string[] = [];
    let arrive!: () => void;
    const claimed = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    let release!: () => void;
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wrapped = {
      withdrawRequest: db!.withdrawRequest,
      $transaction: undefined as unknown,
    };
    wrapped.$transaction = (callback: (tx: unknown) => Promise<unknown>) =>
      db!.$transaction(async (tx) => {
        const wrappedTx = {
          user: tx.user,
          wallet: tx.wallet,
          balanceLog: tx.balanceLog,
          withdrawRequest: { ...tx.withdrawRequest },
          $executeRaw: (...args: Parameters<typeof tx.$executeRaw>) => {
            events.push('wallet');
            return tx.$executeRaw(...args);
          },
        };
        wrappedTx.withdrawRequest.updateMany = async (
          ...args: Parameters<typeof tx.withdrawRequest.updateMany>
        ) => {
          events.push('claim');
          const result = await tx.withdrawRequest.updateMany(...args);
          arrive();
          await proceed;
          return result;
        };
        return callback(wrappedTx);
      });
    const notify = { notifyWithdrawal: async () => {} };
    const approval = new ApproveWithdrawalUseCase(
      wrapped as never,
      notify as never,
    ).execute(withdrawal.id);
    const approvalResult = Promise.allSettled([approval]);
    await Promise.race([
      claimed,
      approval.then(() => {
        throw new Error('Approval finished before claim');
      }),
    ]);
    const rejection = new RejectWithdrawalUseCase(
      db as unknown as PrismaService,
      notify as never,
    ).execute(withdrawal.id, 'local test');
    release();
    const [a, r] = await Promise.all([
      approvalResult,
      Promise.allSettled([rejection]),
    ]);
    expect(events[0]).toBe('claim');
    expect(a[0].status).toBe('fulfilled');
    expect(r[0].status).toBe('rejected');
  },
);
run(
  'concurrent withdrawal requests cannot reserve the same available funds',
  async () => {
    const u = await user();
    await entry(u.id);
    const repository = new PrismaWithdrawRepository(
      db as unknown as PrismaService,
    );
    const input = {
      userId: u.id,
      grossAmount: 80,
      fee: 0,
      amount: 80,
      pixKey: 'local',
      amountToLock: 80,
    };
    const results = await Promise.allSettled([
      repository.createWithWalletLock(input),
      repository.createWithWalletLock(input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await db!.wallet.findUniqueOrThrow({ where: { userId: u.id } })
      ).lockedBalance.toFixed(2),
    ).toBe('80.00');
  },
);
