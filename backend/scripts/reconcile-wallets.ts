/**
 * Read-only: bun scripts/reconcile-wallets.ts
 * Explicit correction: --apply --adjust-ledger=<email> --confirm-host=<hostname>
 * Append both signed deltas; never modify the wallet or historical rows.
 * Remote/shared operations require separate explicit authorization.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { findWalletLedgerDivergences } from '../src/modules/wallet-ledger/wallet-balance';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const host = new URL(url).hostname;
const apply = process.argv.includes('--apply');
const email = process.argv
  .find((arg) => arg.startsWith('--adjust-ledger='))
  ?.slice(16);
if (apply && (!email || !process.argv.includes(`--confirm-host=${host}`))) {
  throw new Error(
    `--apply needs --adjust-ledger=<email> --confirm-host=${host}`,
  );
}
if (process.argv.some((arg) => arg.startsWith('--adjust-tail='))) {
  throw new Error(
    '--adjust-tail removed; review SUM-based drift and use --adjust-ledger',
  );
}
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

async function main() {
  console.log(`database host: ${host} (${apply ? 'APPLY' : 'read-only'})`);
  const drifts = await findWalletLedgerDivergences(db);
  for (const drift of drifts) {
    console.log(
      `${drift.email} balance=${drift.balance} ledger=${drift.ledgerBalance} locked=${drift.lockedBalance} ledgerLocked=${drift.ledgerLockedBalance}`,
    );
  }
  if (!apply) return;
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { email } });
    // Serialize correction with all production wallet writers before reading ledger sums.
    const wallets = await tx.$queryRaw<
      Array<{ balance: Prisma.Decimal; lockedBalance: Prisma.Decimal }>
    >`
      SELECT balance, "lockedBalance" FROM "Wallet" WHERE "userId" = ${user.id} FOR UPDATE
    `;
    const wallet = wallets[0];
    if (!wallet) throw new Error('Wallet missing');
    const totals = await tx.balanceLog.aggregate({
      where: { userId: user.id },
      _sum: { balanceDelta: true, lockedDelta: true },
    });
    const balanceDelta = wallet.balance.sub(totals._sum.balanceDelta ?? 0);
    const lockedDelta = wallet.lockedBalance.sub(totals._sum.lockedDelta ?? 0);
    if (balanceDelta.isZero() && lockedDelta.isZero()) return;
    await tx.balanceLog.create({
      data: {
        userId: user.id,
        action: 'ADJUSTMENT',
        source: 'RECONCILIATION',
        balanceDelta,
        lockedDelta,
        description:
          'Correção explícita do ledger para a projeção atual; histórico preservado',
        metadata: {
          databaseHost: host,
          reason: 'Explicit operator-reviewed projection reconciliation',
          walletBalance: wallet.balance.toFixed(2),
          walletLockedBalance: wallet.lockedBalance.toFixed(2),
          priorLedgerBalance: (
            totals._sum.balanceDelta ?? new Prisma.Decimal(0)
          ).toFixed(2),
          priorLedgerLockedBalance: (
            totals._sum.lockedDelta ?? new Prisma.Decimal(0)
          ).toFixed(2),
          balanceDelta: balanceDelta.toFixed(2),
          lockedDelta: lockedDelta.toFixed(2),
        },
      },
    });
  });
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
