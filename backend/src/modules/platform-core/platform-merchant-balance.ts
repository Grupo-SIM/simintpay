import { Prisma } from '@prisma/client';
import { PlatformAttributedBalance } from './platform-attributed-balance';
import type { PlatformContext } from './platform-context.service';

/**
 * Platforms whose merchants draw only on their own platform's attributed earnings (`PlatformAttributedBalance`,
 * keyed by `Transaction.platformTag`). The seller wallet is pooled across platforms; everywhere else it stays
 * pooled until that platform's credits are attributed and audited.
 */
export const PLATFORM_SCOPED_BALANCE_TAGS: readonly string[] = ['EBOOK'];

export const isPlatformScopedBalance = (tag: string) =>
  PLATFORM_SCOPED_BALANCE_TAGS.includes(tag.toUpperCase());

const ZERO = new Prisma.Decimal(0);

/** Merchant attribution inside the caller's snapshot, plus the pooled wallet cap. */
export async function merchantScopedBalance(
  client: Prisma.TransactionClient,
  context: PlatformContext,
  merchantUserId: string,
) {
  const attributed = await new PlatformAttributedBalance(
    client as never,
  ).readSnapshot(client, context, false, merchantUserId);
  const wallet = await client.wallet.findUnique({
    where: { userId: merchantUserId },
  });
  const poolBalance = new Prisma.Decimal(wallet?.balance ?? 0);
  const poolAvailable = Prisma.Decimal.max(
    ZERO,
    poolBalance.minus(wallet?.lockedBalance ?? 0),
  );
  const available = Prisma.Decimal.min(
    new Prisma.Decimal(attributed.availableBalanceCents).div(100),
    poolAvailable,
  );
  return { attributed, poolBalance, poolAvailable, available };
}
