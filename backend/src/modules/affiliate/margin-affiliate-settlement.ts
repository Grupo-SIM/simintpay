import { ConflictException } from '@nestjs/common';
import {
  Prisma,
  type Transaction,
  type TransactionStatus,
} from '@prisma/client';
import type { Snapshot } from '../coproduction/coproduction';
import { canonicalTransactionPlatformTag } from '../platform-core/transaction-platform';
import { applyWalletEntry } from '../wallet-ledger/wallet-ledger';
import { marginCents, marginCommission } from './margin-affiliate';

type Allocation = {
  userId: string;
  amount: Prisma.Decimal;
  state: 'AVAILABLE' | 'LOCKED' | 'REVERSED';
};

/**
 * Status CAS is held by the caller. Each margin coproducer and the margin affiliate gets a
 * percentage of the SimIntPay margin frozen at the first credit (COMPLETED); later states reuse the stored amount. A sale without positive
 * margin creates no allocation and every later status is a no-op. Idempotent per (transaction, user).
 */
export async function settleMarginAffiliate(
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
  const shares = [
    ...(snapshot.marginParticipants ?? []).map((p) => ({
      userId: p.userId,
      percentageBps: p.percentageBps,
      isRenewal: false,
    })),
    ...(snapshot.marginAffiliate
      ? [
          {
            userId: snapshot.marginAffiliate.userId,
            percentageBps: snapshot.marginAffiliate.percentageBps,
            isRenewal: !!snapshot.marginAffiliate.isRenewal,
          },
        ]
      : []),
  ];
  if (!target || !shares.length) return;
  let allocations = await tx.$queryRaw<
    Allocation[]
  >`SELECT "userId", amount, state FROM "MarginAffiliateAllocation" WHERE "transactionId" = ${row.id} ORDER BY "userId" FOR UPDATE`;
  if (!allocations.length) {
    if (row.status !== 'PENDING' && row.status !== 'DRAFT') return;
    if (target !== 'AVAILABLE')
      throw new ConflictException('Cobrança ainda não creditada');
    const margin = marginCents(
      row.financialSnapshot,
      row.amount,
      row.netAmount,
    );
    allocations = [];
    for (const share of [...shares].sort((a, b) =>
      a.userId.localeCompare(b.userId),
    )) {
      const amount = marginCommission(margin, share.percentageBps);
      if (amount.lte(0)) continue;
      await tx.$executeRaw`INSERT INTO "MarginAffiliateAllocation" ("transactionId", "userId", amount, state, "isRenewal") VALUES (${row.id}, ${share.userId}, ${amount}, 'REVERSED', ${share.isRenewal})`;
      allocations.push({ userId: share.userId, amount, state: 'REVERSED' });
    }
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
      action: `AFFILIATE_MARGIN_${status}`,
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
        basis: 'SIMINTPAY_MARGIN',
        ownerUserId: snapshot.ownerUserId,
        productId: snapshot.productId,
        platformId: snapshot.marginAffiliate?.platformId ?? null,
      },
    });
    await tx.$executeRaw`UPDATE "MarginAffiliateAllocation" SET state = ${target} WHERE "transactionId" = ${row.id} AND "userId" = ${share.userId}`;
  }
}
