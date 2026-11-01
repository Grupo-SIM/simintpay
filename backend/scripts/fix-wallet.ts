/**
 * Deducts APPROVED-but-undebited withdrawals from one user's wallet.
 * Dry run: bun scripts/fix-wallet.ts --user-id=<id>
 * Apply:   --apply --user-id=<id> --confirm-host=<hostname>
 * Only appends an ADJUSTMENT BalanceLog row; the database trigger moves the Wallet.
 * Remote/shared operations require separate explicit authorization.
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { lockWalletLedger } from '../src/modules/wallet-ledger/wallet-ledger';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL não está definida');
const host = new URL(connectionString).hostname;
const apply = process.argv.includes('--apply');
const userId = process.argv
  .find((arg) => arg.startsWith('--user-id='))
  ?.slice('--user-id='.length);
if (!userId) throw new Error('--user-id=<id> é obrigatório');
if (apply && !process.argv.includes(`--confirm-host=${host}`)) {
  throw new Error(`--apply exige --confirm-host=${host}`);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const approvedWithdraws = await prisma.withdrawRequest.findMany({
    where: { userId, status: 'APPROVED' },
  });

  if (approvedWithdraws.length === 0) {
    console.log(
      'Nenhum saque em estado "APPROVED" encontrado para este usuário.',
    );
    return;
  }

  const totalToDeduct = approvedWithdraws.reduce(
    (acc, w) => acc.add(w.grossAmount),
    new Prisma.Decimal(0),
  );
  console.log(`Encontrados ${approvedWithdraws.length} saques aprovados.`);
  console.log(`Total a deduzir: R$ ${totalToDeduct.toFixed(2)}`);
  if (!apply) {
    console.log('Dry run: nada foi alterado (use --apply --confirm-host).');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Lock before reading the balance used to compute the deltas.
    await lockWalletLedger(tx, userId);
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error('Usuário sem carteira.');
    const balanceDelta = totalToDeduct.neg();
    // lockedBalance never goes below zero.
    const lockedDelta = Prisma.Decimal.min(
      wallet.lockedBalance,
      totalToDeduct,
    ).neg();
    await tx.balanceLog.create({
      data: {
        userId,
        action: 'ADJUSTMENT',
        source: 'FIX_WALLET_SCRIPT',
        balanceDelta,
        lockedDelta,
        description: 'Dedução de saques APPROVED não debitados',
        metadata: {
          databaseHost: host,
          withdrawIds: approvedWithdraws.map((w) => w.id),
          priorBalance: wallet.balance.toFixed(2),
          priorLockedBalance: wallet.lockedBalance.toFixed(2),
        },
      },
    });
  });
  console.log(
    '✓ Ajuste registrado no BalanceLog; carteira recalculada pelo trigger.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
