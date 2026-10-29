import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { getWalletBalance } from '../../modules/wallet-ledger/wallet-balance';

/**
 * Withdrawable balance of any account: `max(0, wallet.balance − wallet.lockedBalance)`.
 * Kept as the name existing callers use; the rule lives in getWalletBalance.
 * `tenantSlug` is ignored: there is no per-platform balance formula anymore.
 */
export async function computeUserNetBalance(
  prisma: PrismaService,
  userId: string,
  tenantSlug?: string | null,
): Promise<number> {
  void tenantSlug;
  return (await getWalletBalance(prisma, userId)).available;
}
