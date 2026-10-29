import { afterAll, expect, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { applyWalletEntry, setWalletBalance } from '../wallet-ledger';

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
afterAll(async () => {
  await db?.$disconnect();
});
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 30000);

const newUser = () =>
  db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Ledger',
      password: 'x',
      role: 'USER',
    },
  });

async function chain(userId: string) {
  const rows = await db!.balanceLog.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const wallet = await db!.wallet.findUniqueOrThrow({ where: { userId } });
  return { rows, wallet };
}

run('credit, lock and debit keep wallet and log in step', async () => {
  const user = await newUser();
  await db!.$transaction(async (tx) => {
    await applyWalletEntry(tx, {
      userId: user.id,
      action: 'CREDIT',
      source: 'TEST',
      balanceDelta: 100,
    });
    await applyWalletEntry(tx, {
      userId: user.id,
      action: 'LOCK',
      source: 'TEST',
      lockedDelta: 30,
    });
    await applyWalletEntry(tx, {
      userId: user.id,
      action: 'DEBIT',
      source: 'TEST',
      balanceDelta: -30,
      lockedDelta: -30,
    });
  });
  const { rows, wallet } = await chain(user.id);
  expect(rows.map((r) => r.balanceAfter.toFixed(2))).toEqual([
    '100.00',
    '100.00',
    '70.00',
  ]);
  expect(rows.map((r) => r.lockedAfter.toFixed(2))).toEqual([
    '0.00',
    '30.00',
    '0.00',
  ]);
  expect(wallet.balance.toFixed(2)).toBe('70.00');
  expect(wallet.lockedBalance.toFixed(2)).toBe('0.00');
  expect(rows[1].amount.toFixed(2)).toBe('30.00');
});

run(
  'concurrent entries produce an unbroken chain that ends at the wallet balance',
  async () => {
    const user = await newUser();
    await db!.wallet.create({ data: { userId: user.id } });
    await Promise.all(
      Array.from({ length: 12 }, () =>
        db!.$transaction((tx) =>
          applyWalletEntry(tx, {
            userId: user.id,
            action: 'CREDIT',
            source: 'TEST',
            balanceDelta: 5,
          }),
        ),
      ),
    );
    const { rows, wallet } = await chain(user.id);
    expect(rows).toHaveLength(12);
    expect(wallet.balance.toFixed(2)).toBe('60.00');
    const sorted = [...rows].sort((a, b) => a.balanceAfter.cmp(b.balanceAfter));
    sorted.forEach((row, i) => {
      expect(row.balanceBefore.toFixed(2)).toBe((i * 5).toFixed(2));
      expect(row.balanceAfter.toFixed(2)).toBe(((i + 1) * 5).toFixed(2));
    });
  },
);

run(
  'rolling back the transaction drops both wallet and log changes',
  async () => {
    const user = await newUser();
    let failure: unknown;
    try {
      await db!.$transaction(async (tx) => {
        await applyWalletEntry(tx, {
          userId: user.id,
          action: 'CREDIT',
          source: 'TEST',
          balanceDelta: 50,
        });
        throw new Error('boom');
      });
    } catch (error) {
      failure = error;
    }
    expect((failure as Error).message).toBe('boom');
    expect(await db!.balanceLog.count({ where: { userId: user.id } })).toBe(0);
    expect(
      await db!.wallet.findUnique({ where: { userId: user.id } }),
    ).toBeNull();
  },
);

run('setWalletBalance logs the difference to the absolute value', async () => {
  const user = await newUser();
  await db!.$transaction(async (tx) => {
    await applyWalletEntry(tx, {
      userId: user.id,
      action: 'CREDIT',
      source: 'TEST',
      balanceDelta: 80,
    });
    await setWalletBalance(tx, {
      userId: user.id,
      action: 'ADJUSTMENT',
      source: 'RECONCILIATION',
      balance: 55.5,
    });
  });
  const { rows, wallet } = await chain(user.id);
  expect(wallet.balance.toFixed(2)).toBe('55.50');
  expect(rows[1].amount.toFixed(2)).toBe('-24.50');
  expect(rows[1].balanceBefore.toFixed(2)).toBe('80.00');
  expect(rows[1].balanceAfter.toFixed(2)).toBe('55.50');
});
