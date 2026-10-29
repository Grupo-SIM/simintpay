import { Prisma } from '@prisma/client';

type BalanceClient = Pick<Prisma.TransactionClient, 'wallet' | 'balanceLog'>;

/** Fee bookkeeping rows (balanceBefore = balanceAfter = 0). They never move the wallet. */
const BOOKKEEPING_SOURCE = 'MASTER_ADMIN_CONTROL';

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
  /** balanceAfter of the last BalanceLog row that moved the wallet; null when there is none. */
  ledgerBalance: number | null;
  /** wallet.balance minus the ledger tail; 0 when wallet and ledger agree. */
  ledgerDrift: number;
}

/**
 * Single read of an account's balance. Plain accounts, platform owners, co-producers and affiliates
 * share one wallet, so the same rule serves /me, withdraw summary, reports and admin tools.
 * The wallet is the authority; the ledger tail is reported so callers can surface drift.
 */
export async function getWalletBalance(
  client: BalanceClient,
  userId: string,
): Promise<WalletBalance> {
  const wallet = await client.wallet.findUnique({ where: { userId } });
  if (!wallet)
    return {
      balance: 0,
      lockedBalance: 0,
      available: 0,
      ledgerBalance: null,
      ledgerDrift: 0,
    };
  const last = await client.balanceLog.findFirst({
    where: { userId, NOT: { source: BOOKKEEPING_SOURCE } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { balanceAfter: true },
  });
  const available = Prisma.Decimal.max(
    0,
    wallet.balance.sub(wallet.lockedBalance),
  );
  return {
    balance: toMoney(wallet.balance),
    lockedBalance: toMoney(wallet.lockedBalance),
    available: toMoney(available),
    ledgerBalance: last ? toMoney(last.balanceAfter) : null,
    ledgerDrift: toMoney(wallet.balance.sub(last?.balanceAfter ?? 0)),
  };
}

export interface WalletDivergence {
  userId: string;
  walletBalance: string;
  ledgerBalance: string;
}

/** Read-only: wallets whose balance differs from the last ledger row that moved them. */
export async function findWalletLedgerDivergences(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<WalletDivergence[]> {
  return client.$queryRaw<WalletDivergence[]>`
    SELECT w."userId" AS "userId",
           w.balance::text AS "walletBalance",
           COALESCE(l."balanceAfter", 0)::text AS "ledgerBalance"
    FROM "Wallet" w
    LEFT JOIN LATERAL (
      SELECT "balanceAfter" FROM "BalanceLog" b
      WHERE b."userId" = w."userId" AND b.source <> ${BOOKKEEPING_SOURCE}
      ORDER BY b."createdAt" DESC, b.id DESC
      LIMIT 1
    ) l ON true
    WHERE w.balance <> COALESCE(l."balanceAfter", 0)`;
}
