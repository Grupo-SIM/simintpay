import { Prisma } from '@prisma/client';

type LedgerClient = Pick<Prisma.TransactionClient, 'wallet' | 'balanceLog'>;

export interface WalletLedgerEntry {
  userId: string;
  /** Registered in BalanceLog.action, e.g. DOM_WEBHOOK_COMPLETED. */
  action: string;
  /** Registered in BalanceLog.source, e.g. DOM_WEBHOOK. */
  source: string;
  /** Change applied to wallet.balance. Zero is allowed for locked-only moves. */
  balanceDelta?: Prisma.Decimal.Value;
  /** Change applied to wallet.lockedBalance. */
  lockedDelta?: Prisma.Decimal.Value;
  transactionId?: string | null;
  description?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Single writer for wallet balance: moves the wallet and appends the matching BalanceLog row.
 * Must run inside the caller's database transaction so wallet and ledger never diverge.
 * `before` values come from the row returned by the update, never from an earlier read.
 */
export async function applyWalletEntry(
  client: LedgerClient,
  entry: WalletLedgerEntry,
) {
  const balanceDelta = new Prisma.Decimal(entry.balanceDelta ?? 0);
  const lockedDelta = new Prisma.Decimal(entry.lockedDelta ?? 0);
  await client.wallet.upsert({
    where: { userId: entry.userId },
    update: {},
    create: { userId: entry.userId, balance: 0, lockedBalance: 0 },
  });
  const wallet = await client.wallet.update({
    where: { userId: entry.userId },
    data: {
      balance: { increment: balanceDelta },
      lockedBalance: { increment: lockedDelta },
      version: { increment: 1 },
    },
  });
  await client.balanceLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      source: entry.source,
      transactionId: entry.transactionId ?? null,
      description: entry.description ?? null,

      balanceDelta,
      lockedDelta,
      metadata: entry.metadata,
    },
  });
  return wallet;
}

/**
 * Sets the wallet to an absolute value (admin sync/maintenance), logging the difference.
 * Reads inside the caller transaction; run it under a serializable transaction when concurrent writers exist.
 */
export async function setWalletBalance(
  client: LedgerClient,
  input: Omit<WalletLedgerEntry, 'balanceDelta' | 'lockedDelta'> & {
    balance: Prisma.Decimal.Value;
  },
) {
  const { balance, ...entry } = input;
  await client.wallet.upsert({
    where: { userId: entry.userId },
    update: {},
    create: { userId: entry.userId, balance: 0, lockedBalance: 0 },
  });
  const current = await client.wallet.findUniqueOrThrow({
    where: { userId: entry.userId },
  });
  const wallet = await client.wallet.update({
    where: { id: current.id, version: current.version },
    data: { balance: new Prisma.Decimal(balance), version: { increment: 1 } },
  });
  await client.balanceLog.create({
    data: {
      ...entry,
      balanceDelta: wallet.balance.sub(current.balance),
      lockedDelta: 0,
    },
  });
  return wallet;
}
