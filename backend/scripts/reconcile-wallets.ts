/**
 * Reconciles Wallet against BalanceLog.
 *
 *   bun scripts/reconcile-wallets.ts            read-only report
 *   bun scripts/reconcile-wallets.ts --apply    appends ADJUSTMENT rows for chain gaps (writes!)
 *
 * Rows from source MASTER_ADMIN_CONTROL are fee bookkeeping (balanceBefore = balanceAfter = 0) and
 * never move the wallet, so they are ignored. Locked-balance gaps are only reported. Existing rows are never edited; gaps are closed with
 * ADJUSTMENT / RECONCILIATION rows placed 1 ms before the row that exposed the gap.
 * The target database comes from DATABASE_URL; --apply requires --confirm-host=<hostname> to match it.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const host = new URL(url).hostname;
const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes(`--confirm-host=${host}`)) {
  throw new Error(`--apply needs --confirm-host=${host}`);
}
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

const ZERO = new Prisma.Decimal(0);
const fmt = (d: Prisma.Decimal) => d.toFixed(2);

async function main() {
  console.log(`database host: ${host} (${apply ? 'APPLY' : 'read-only'})`);
  const wallets = await db.wallet.findMany({
    include: { user: { select: { email: true } } },
  });
  let tail = 0;
  let gaps = 0;
  let lockGaps = 0;
  for (const wallet of wallets) {
    const rows = await db.balanceLog.findMany({
      where: { userId: wallet.userId, NOT: { source: 'MASTER_ADMIN_CONTROL' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const fixes: Prisma.BalanceLogCreateManyInput[] = [];
    let prev: Prisma.Decimal | null = null;
    let prevLocked: Prisma.Decimal | null = null;
    for (const row of rows) {
      if (prev && !prevLocked!.eq(row.lockedBefore)) {
        lockGaps++;
        console.log(
          `LOCK  ${wallet.user.email} ${row.createdAt.toISOString()} ${row.action}: locked ${fmt(prevLocked!)} -> ${fmt(row.lockedBefore)} (report only)`,
        );
      }
      if (prev && !prev.eq(row.balanceBefore)) {
        gaps++;
        const gap = row.balanceBefore.sub(prev);
        console.log(
          `GAP   ${wallet.user.email} ${row.createdAt.toISOString()} ${row.action}: ${fmt(prev)} -> ${fmt(row.balanceBefore)} (${fmt(gap)})`,
        );
        fixes.push({
          userId: wallet.userId,
          action: 'ADJUSTMENT',
          source: 'RECONCILIATION',
          amount: gap,
          balanceBefore: prev,
          balanceAfter: row.balanceBefore,
          lockedBefore: row.lockedBefore,
          lockedAfter: row.lockedBefore,
          description:
            'Conciliação: movimentação sem lançamento anterior no ledger (plano 0007)',
          metadata: { reason: 'chain-gap', before: row.id, plan: '0007' },
          createdAt: new Date(row.createdAt.getTime() - 1),
        });
      }
      prev = row.balanceAfter;
      prevLocked = row.lockedAfter;
    }
    const lastBalance = prev ?? ZERO;
    const lastLocked = prevLocked ?? ZERO;
    if (
      !wallet.balance.eq(lastBalance) ||
      !wallet.lockedBalance.eq(lastLocked)
    ) {
      tail++;
      console.log(
        `TAIL  ${wallet.user.email} wallet ${fmt(wallet.balance)}/${fmt(wallet.lockedBalance)} log ${fmt(lastBalance)}/${fmt(lastLocked)}`,
      );
    }
    if (apply && fixes.length) {
      await db.$transaction(async (tx) => {
        const current = await tx.wallet.findUniqueOrThrow({
          where: { userId: wallet.userId },
        });
        if (
          !current.balance.eq(wallet.balance) ||
          current.version !== wallet.version
        )
          throw new Error(`wallet changed: ${wallet.user.email}`);
        await tx.balanceLog.createMany({ data: fixes });
      });
      console.log(
        `APPLIED ${fixes.length} adjustment(s) for ${wallet.user.email}`,
      );
    }
  }
  console.log(
    `wallets: ${wallets.length}, balance chain gaps: ${gaps}, locked chain gaps (report only): ${lockGaps}, wallet/log tail mismatches: ${tail}`,
  );
}

main().finally(() => db.$disconnect());
