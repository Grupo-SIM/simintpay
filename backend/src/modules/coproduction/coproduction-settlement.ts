import { ConflictException } from '@nestjs/common';
import {
  Prisma,
  type Transaction,
  type TransactionStatus,
} from '@prisma/client';
import { allocateNet, snapshotFrom } from './coproduction';
import { applyWalletEntry } from '../wallet-ledger/wallet-ledger';

type Allocation = {
  userId: string;
  amount: Prisma.Decimal;
  state: 'AVAILABLE' | 'LOCKED' | 'REVERSED';
};

/** Status CAS is held by the caller. Allocation, every wallet and audits share its transaction. */
export async function settleCoproduction(
  tx: Prisma.TransactionClient,
  row: Transaction,
  status: TransactionStatus,
  source: string,
): Promise<boolean> {
  const snapshot = snapshotFrom(row.financialSnapshot);
  if (!snapshot) return false;
  if (snapshot.ownerUserId !== row.userId || row.netAmount == null)
    throw new ConflictException(
      'Proprietário ou líquido incompatível com snapshot',
    );
  const target =
    status === 'COMPLETED'
      ? 'AVAILABLE'
      : status === 'IN_MEDIATION'
        ? 'LOCKED'
        : ['REFUNDED', 'CHARGEBACK'].includes(status)
          ? 'REVERSED'
          : null;
  if (!target) return true;
  let allocations = await tx.$queryRaw<
    Allocation[]
  >`SELECT "userId", amount, state FROM "CoproductionAllocation" WHERE "transactionId" = ${row.id} ORDER BY "userId" FOR UPDATE`;
  if (!allocations.length) {
    if (row.status !== 'PENDING' && row.status !== 'DRAFT')
      throw new ConflictException('Distribuição original ausente');
    if (target !== 'AVAILABLE')
      throw new ConflictException('Cobrança ainda não creditada');
    const shares = allocateNet(snapshot, row.netAmount);
    for (const share of shares)
      await tx.$executeRaw`INSERT INTO "CoproductionAllocation" ("transactionId", "userId", amount, state) VALUES (${row.id}, ${share.userId}, ${share.amount}, 'REVERSED')`;
    allocations = shares.map((s) => ({ ...s, state: 'REVERSED' }));
  }
  // Stable ordering prevents deadlocks between sales sharing several beneficiaries.
  for (const share of allocations) {
    if (share.state === target) continue;
    const value = new Prisma.Decimal(share.amount);
    // Wallet balance includes reserved principal; availability subtracts lockedBalance once.
    const balanceDelta = (
      target === 'REVERSED' ? new Prisma.Decimal(0) : value
    ).sub(share.state === 'REVERSED' ? 0 : value);
    const lockedDelta = (
      target === 'LOCKED' ? value : new Prisma.Decimal(0)
    ).sub(share.state === 'LOCKED' ? value : 0);
    await applyWalletEntry(tx, {
      userId: share.userId,
      action: `COPRODUCTION_${status}`,
      source,
      balanceDelta,
      lockedDelta,
      transactionId: row.id,
      metadata: {
        product: snapshot.product,
        productId: snapshot.productId,
        version: snapshot.version,
        ownerUserId: snapshot.ownerUserId,
      },
    });
    await tx.$executeRaw`UPDATE "CoproductionAllocation" SET state = ${target} WHERE "transactionId" = ${row.id} AND "userId" = ${share.userId}`;
  }
  return true;
}
