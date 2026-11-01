import { Prisma } from '@prisma/client';

type LedgerClient = Pick<
  Prisma.TransactionClient,
  'wallet' | 'balanceLog' | '$executeRaw'
>;
type LockClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/** Internal accounting dimensions, not a public response/status enum. */
export type WalletEntryNature =
  | 'SALE'
  | 'COMMISSION'
  | 'COPRODUCTION'
  | 'WITHDRAWAL'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'TRANSFER';

export type WalletEntryDimensions = {
  /** Canonical platform tag, explicitly audited by the caller; never inferred from ownership. */
  platformTag?: string | null;
  nature?: WalletEntryNature | null;
};

/** Advisory-lock key text; mirrors balance_log_sync_wallet() in the 20261031130000 migration. */
export const walletLedgerLockKey = (userId: string) =>
  `wallet-ledger:${userId}`;

/**
 * Serializes ledger writers of one user until the end of the caller's transaction.
 * Same order as the BalanceLog insert trigger: Wallet row lock first, then
 * `pg_advisory_xact_lock(hashtext('wallet-ledger:' || userId))`. Call it before reading the
 * wallet to decide a withdrawal so no concurrent log insert can change the sums meanwhile.
 * Must run inside a database transaction.
 */
export async function lockWalletLedger(client: LockClient, userId: string) {
  await client.$executeRaw`SELECT 1 FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${walletLedgerLockKey(userId)}))`;
}

/** Fail closed before a withdrawal decision; never repair an inconsistent cache here. */
export async function assertWalletLedgerConsistency(
  client: LockClient,
  userId: string,
) {
  await lockWalletLedger(client, userId);
  await client.$executeRaw`SELECT wallet_assert_ledger_consistency(${userId}::text)`;
}

export interface WalletLedgerEntry extends WalletEntryDimensions {
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
 * Single writer for wallet balance: appends the BalanceLog row; the database trigger
 * `balance_log_sync_wallet` recomputes the Wallet from SUM(BalanceLog) under a per-user lock.
 * Must run inside the caller's database transaction. Returns the wallet as updated by the trigger.
 */
export async function applyWalletEntry(
  client: LedgerClient,
  entry: WalletLedgerEntry,
) {
  const balanceDelta = new Prisma.Decimal(entry.balanceDelta ?? 0);
  const lockedDelta = new Prisma.Decimal(entry.lockedDelta ?? 0);
  await client.balanceLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      source: entry.source,
      platformTag: entry.platformTag ?? null,
      nature: entry.nature ?? null,
      transactionId: entry.transactionId ?? null,
      description: entry.description ?? null,

      balanceDelta,
      lockedDelta,
      metadata: entry.metadata,
    },
  });
  return client.wallet.findUniqueOrThrow({ where: { userId: entry.userId } });
}

/**
 * Sets the wallet to an absolute value (admin sync/maintenance), logging the difference.
 * Locks the user's ledger (lockWalletLedger), reads the current balance and inserts only the BalanceLog
 * difference; the trigger moves the Wallet.
 */
export async function setWalletBalance(
  client: LedgerClient,
  input: Omit<WalletLedgerEntry, 'balanceDelta' | 'lockedDelta'> & {
    balance: Prisma.Decimal.Value;
  },
) {
  const { balance, ...entry } = input;
  await lockWalletLedger(client, entry.userId);
  const current = await client.wallet.findUnique({
    where: { userId: entry.userId },
  });
  await client.balanceLog.create({
    data: {
      ...entry,
      balanceDelta: new Prisma.Decimal(balance).sub(current?.balance ?? 0),
      lockedDelta: 0,
    },
  });
  return client.wallet.findUniqueOrThrow({ where: { userId: entry.userId } });
}
