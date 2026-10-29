import { Prisma } from '@prisma/client';

type BalanceClient = Pick<Prisma.TransactionClient, 'wallet' | 'balanceLog'>;

const toMoney = (value: Prisma.Decimal) => Number(value.toFixed(2));

/** The withdrawable-balance rule, applied to a wallet row already in hand (no extra query). */
export function walletAmounts(wallet: {
  balance: Prisma.Decimal.Value;
  lockedBalance: Prisma.Decimal.Value;
}) {
  const balance = new Prisma.Decimal(wallet.balance);
  const locked = new Prisma.Decimal(wallet.lockedBalance);
  return {
    balance: toMoney(balance),
    lockedBalance: toMoney(locked),
    available: toMoney(Prisma.Decimal.max(0, balance.sub(locked))),
  };
}

export interface WalletBalance {
  balance: number;
  lockedBalance: number;
  /** max(0, balance - lockedBalance): the only withdrawable-balance rule, for every account. */
  available: number;
  /** Sum of every signed balance movement, including empty zero opening. */
  ledgerBalance: number;
  ledgerLockedBalance: number;
  /** Wallet projection minus summed balance movements. */
  ledgerDrift: number;
  ledgerLockedDrift: number;
}

/**
 * Single read of an account's balance. Plain accounts, platform owners, co-producers and affiliates
 * share one wallet, so the same rule serves /me, withdraw summary, reports and admin tools.
 * Wallet is the atomically maintained projection; both summed deltas expose drift.
 */
export async function getWalletBalance(
  client: BalanceClient,
  userId: string,
): Promise<WalletBalance> {
  const wallet = await client.wallet.findUnique({ where: { userId } });
  const totals = await client.balanceLog.aggregate({
    where: { userId },
    _sum: { balanceDelta: true, lockedDelta: true },
  });
  const balance = new Prisma.Decimal(wallet?.balance ?? 0);
  const locked = new Prisma.Decimal(wallet?.lockedBalance ?? 0);
  const ledgerBalance = totals._sum.balanceDelta ?? new Prisma.Decimal(0);
  const ledgerLocked = totals._sum.lockedDelta ?? new Prisma.Decimal(0);
  return {
    ...walletAmounts({ balance, lockedBalance: locked }),
    ledgerBalance: toMoney(ledgerBalance),
    ledgerLockedBalance: toMoney(ledgerLocked),
    ledgerDrift: toMoney(balance.sub(ledgerBalance)),
    ledgerLockedDrift: toMoney(locked.sub(ledgerLocked)),
  };
}

/** Read-only, consistent snapshot of both projections and all ledger movements. */
export async function findWalletLedgerDivergences(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
) {
  return client.$queryRaw<
    Array<{
      userId: string;
      email: string;
      balance: Prisma.Decimal;
      lockedBalance: Prisma.Decimal;
      ledgerBalance: Prisma.Decimal;
      ledgerLockedBalance: Prisma.Decimal;
      drift: Prisma.Decimal;
      lockedDrift: Prisma.Decimal;
    }>
  >(Prisma.sql`
    WITH totals AS (
      SELECT "userId", SUM("balanceDelta") AS balance, SUM("lockedDelta") AS locked
      FROM "BalanceLog" GROUP BY "userId"
    )
    SELECT u.id AS "userId", u.email, COALESCE(w.balance, 0) AS balance,
           COALESCE(w."lockedBalance", 0) AS "lockedBalance",
           COALESCE(t.balance, 0) AS "ledgerBalance",
           COALESCE(t.locked, 0) AS "ledgerLockedBalance",
           COALESCE(w.balance, 0) - COALESCE(t.balance, 0) AS drift,
           COALESCE(w."lockedBalance", 0) - COALESCE(t.locked, 0) AS "lockedDrift"
    FROM "User" u LEFT JOIN "Wallet" w ON u.id = w."userId"
    LEFT JOIN totals t ON t."userId" = u.id
    WHERE COALESCE(w.balance, 0) <> COALESCE(t.balance, 0)
       OR COALESCE(w."lockedBalance", 0) <> COALESCE(t.locked, 0)
    ORDER BY ABS(COALESCE(w.balance, 0) - COALESCE(t.balance, 0)) DESC, u.email
  `);
}
