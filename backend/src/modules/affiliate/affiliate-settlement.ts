import { ConflictException } from '@nestjs/common';
import {
  Prisma,
  type Transaction,
  type TransactionStatus,
} from '@prisma/client';
import { affiliateAmount, type Snapshot } from '../coproduction/coproduction';
import { canonicalTransactionPlatformTag } from '../platform-core/transaction-platform';
import { applyWalletEntry } from '../wallet-ledger/wallet-ledger';

type Allocation = {
  userId: string;
  amount: Prisma.Decimal;
  state: 'AVAILABLE' | 'LOCKED' | 'REVERSED';
};

/**
 * Status CAS is held by the caller. Idempotent per (transactionId, userId): a replay of the same
 * status finds the allocation already in the target state. Reversals use the stored amount.
 */
export async function settleAffiliate(
  tx: Prisma.TransactionClient,
  row: Transaction,
  snapshot: Snapshot,
  status: TransactionStatus,
  source: string,
): Promise<void> {
  const target =
    status === 'COMPLETED'
      ? 'AVAILABLE'
      : status === 'IN_MEDIATION'
        ? 'LOCKED'
        : ['REFUNDED', 'CHARGEBACK'].includes(status)
          ? 'REVERSED'
          : null;
  if (!target) return;
  let allocations = await tx.$queryRaw<
    Allocation[]
  >`SELECT "userId", amount, state FROM "AffiliateAllocation" WHERE "transactionId" = ${row.id} ORDER BY "userId" FOR UPDATE`;
  if (!allocations.length) {
    if (!snapshot.affiliate || row.netAmount == null) return;
    if (row.status !== 'PENDING' && row.status !== 'DRAFT')
      throw new ConflictException('Comissão original ausente');
    if (target !== 'AVAILABLE')
      throw new ConflictException('Cobrança ainda não creditada');
    const amount = affiliateAmount(snapshot, row.netAmount);
    await tx.$executeRaw`INSERT INTO "AffiliateAllocation" ("transactionId", "userId", amount, state, "isRenewal") VALUES (${row.id}, ${snapshot.affiliate.userId}, ${amount}, 'REVERSED', ${!!snapshot.affiliate.isRenewal})`;
    allocations = [
      { userId: snapshot.affiliate.userId, amount, state: 'REVERSED' },
    ];
  }
  for (const share of allocations) {
    if (share.state === target) continue;
    const value = new Prisma.Decimal(share.amount);
    const balanceDelta = (
      target === 'REVERSED' ? new Prisma.Decimal(0) : value
    ).sub(share.state === 'REVERSED' ? 0 : value);
    const lockedDelta = (
      target === 'LOCKED' ? value : new Prisma.Decimal(0)
    ).sub(share.state === 'LOCKED' ? value : 0);
    await applyWalletEntry(tx, {
      userId: share.userId,
      action: `AFFILIATE_${status}`,
      source,
      platformTag:
        canonicalTransactionPlatformTag(row.platformTag) === 'EBOOK'
          ? 'EBOOK'
          : row.platformTag,
      nature: 'AFFILIATE',
      balanceDelta,
      lockedDelta,
      transactionId: row.id,
      metadata: {
        ownerUserId: snapshot.ownerUserId,
        productId: snapshot.productId,
        platformId: snapshot.affiliate?.platformId ?? null,
      },
    });
    await tx.$executeRaw`UPDATE "AffiliateAllocation" SET state = ${target} WHERE "transactionId" = ${row.id} AND "userId" = ${share.userId}`;
  }
}
