import { ConflictException } from '@nestjs/common';
import { Prisma, TransactionStatus } from '@prisma/client';
import {
  applyWalletEntry,
  lockWalletLedger,
} from '../wallet-ledger/wallet-ledger';
import { allocateEbookCents, type EbookManifest } from './ebook-manifest';

export type EbookAllocation = {
  allocationId: string;
  itemId: string;
  userId: string;
  externalBeneficiaryId: string | null;
  role: 'OWNER' | 'AFFILIATE' | 'COPRODUCER';
  amountCents: number;
};
export type EbookFunding = {
  version: 1;
  grossCents: number;
  feeCents: number;
  feeSnapshot: unknown;
  allocations: EbookAllocation[];
};
export function buildEbookFunding(
  manifest: EbookManifest,
  feeCents: number,
  identities: Record<string, string>,
  copro: { userId: string; percentageBps: number }[],
  feeSnapshot: unknown,
): EbookFunding {
  const fees = allocateEbookCents(feeCents, manifest.items);
  const allocations: EbookAllocation[] = [];
  const participants = [...copro].sort((a, b) =>
    a.userId.localeCompare(b.userId),
  );
  if (
    participants.some(
      (p) => !Number.isSafeInteger(p.percentageBps) || p.percentageBps < 0,
    ) ||
    participants.reduce((sum, p) => sum + p.percentageBps, 0) > 10000
  )
    throw new ConflictException('Co-produção inválida');
  for (const item of manifest.items) {
    const owner = identities[item.owner.externalUserId];
    if (!owner) throw new ConflictException('Identidade do vendedor ausente');
    const affiliate = item.affiliate
      ? Number(
          (BigInt(item.grossCents) * BigInt(item.affiliate.commissionRateBps)) /
            10000n,
        )
      : 0;
    const net = item.grossCents - fees.get(item.itemId)! - affiliate;
    if (net < 0) throw new ConflictException('EBOOK_INSUFFICIENT_CURRENT_SALE');
    const add = (
      role: EbookAllocation['role'],
      userId: string,
      externalBeneficiaryId: string | null,
      amountCents: number,
    ) => {
      if (!userId) throw new ConflictException('Identidade financeira ausente');
      allocations.push({
        allocationId: `${manifest.manifestId}:${item.itemId}:${role}:${userId}`,
        itemId: item.itemId,
        userId,
        externalBeneficiaryId,
        role,
        amountCents,
      });
    };
    if (item.affiliate)
      add(
        'AFFILIATE',
        identities[item.affiliate.externalUserId],
        item.affiliate.externalUserId,
        affiliate,
      );
    let remaining = net;
    for (const participant of participants) {
      if (participant.userId === owner) continue;
      const amount = Number(
        (BigInt(net) * BigInt(participant.percentageBps)) / 10000n,
      );
      remaining -= amount;
      add('COPRODUCER', participant.userId, null, amount);
    }
    add('OWNER', owner, item.owner.externalUserId, remaining);
  }
  if (
    allocations.reduce((sum, a) => sum + a.amountCents, 0) + feeCents !==
    manifest.grossCents
  )
    throw new ConflictException('EBOOK_CONSERVATION_FAILED');
  return {
    version: 1,
    grossCents: manifest.grossCents,
    feeCents,
    feeSnapshot,
    allocations,
  };
}

type StoredEnrollment = {
  id: string;
  manifest: EbookManifest;
  manifestHash: string;
  funding: EbookFunding | null;
  state: string;
  revision: number;
  transactionId: string | null;
};
/** Exclusive route: true means an enrolled payment, including blocked/duplicate/unsupported events. */
export async function settleEbookPayment(
  prisma: {
    $transaction: <T>(
      fn: (p: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>;
  },
  paymentId: string,
  status: string,
  transactionReference?: string,
): Promise<boolean> {
  return prisma.$transaction(async (p) => {
    const rows = await p.$queryRaw<
      StoredEnrollment[]
    >`SELECT * FROM "EbookSettlement" WHERE "providerPaymentId" = ${paymentId} FOR UPDATE`;
    const row = rows[0];
    if (!row) {
      if (transactionReference) {
        const pending = await p.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "EbookSettlement" WHERE "transactionId" = ${transactionReference}`;
        if (pending.length)
          throw new ConflictException('EBOOK_PROVIDER_BINDING_PENDING');
      }
      return false;
    }
    if (!row.funding || !row.transactionId) return true;
    const states: Record<string, string> = {
      paid: 'SETTLED',
      approved: 'SETTLED',
      completed: 'SETTLED',
      capture: 'SETTLED',
      revision_paid: 'SETTLED',
      in_mediation: 'LOCKED',
      refunded: 'REVERSED',
      chargeback: 'REVERSED',
    };
    const target = states[status.toLowerCase()];
    if (!target || target === row.state || row.state === 'REVERSED')
      return true;
    const users = [
      ...new Set(row.funding.allocations.map((a) => a.userId)),
    ].sort();
    for (const userId of users) await lockWalletLedger(p, userId);
    const nextStatus =
      target === 'SETTLED'
        ? TransactionStatus.COMPLETED
        : target === 'LOCKED'
          ? TransactionStatus.IN_MEDIATION
          : status === 'chargeback'
            ? TransactionStatus.CHARGEBACK
            : TransactionStatus.REFUNDED;
    const transaction = await p.transaction.findUniqueOrThrow({
      where: { id: row.transactionId },
    });
    const claim = await p.transaction.updateMany({
      where: { id: row.transactionId, status: transaction.status },
      data: { status: nextStatus, previousStatus: transaction.status },
    });
    if (claim.count !== 1) return true;
    for (const allocation of row.funding.allocations) {
      const amount = new Prisma.Decimal(allocation.amountCents).div(100);
      const beforeBalance =
        row.state === 'SETTLED' ? amount : new Prisma.Decimal(0);
      const beforeLocked =
        row.state === 'LOCKED' ? amount : new Prisma.Decimal(0);
      await applyWalletEntry(p, {
        userId: allocation.userId,
        action: `EBOOK_V1_${target}`,
        source: 'EBOOK_V1',
        platformTag: 'EBOOK',
        nature:
          allocation.role === 'AFFILIATE'
            ? 'COMMISSION'
            : allocation.role === 'COPRODUCER'
              ? 'COPRODUCTION'
              : 'SALE',
        transactionId: row.transactionId,
        balanceDelta: (target === 'SETTLED'
          ? amount
          : new Prisma.Decimal(0)
        ).sub(beforeBalance),
        lockedDelta: (target === 'LOCKED' ? amount : new Prisma.Decimal(0)).sub(
          beforeLocked,
        ),
        metadata: {
          allocationId: allocation.allocationId,
          itemId: allocation.itemId,
          role: allocation.role,
          manifestHash: row.manifestHash,
        },
      });
    }
    const revision = row.revision + 1;
    const receiptId = `${row.id}:${revision}`;
    const receipt = {
      version: 1,
      receiptId,
      settlementId: row.id,
      manifestId: row.manifest.manifestId,
      manifestHash: row.manifestHash,
      orderId: row.manifest.orderId,
      orderNumber: row.manifest.orderNumber,
      transactionId: row.transactionId,
      revision,
      status: target,
      grossCents: row.manifest.grossCents,
      allocations: row.funding.allocations.map((a) => ({
        ...a,
        beneficiaryId: a.userId,
        lockedCents: target === 'LOCKED' ? a.amountCents : 0,
      })),
    };
    await p.$executeRaw`UPDATE "EbookSettlement" SET state = ${target}, revision = ${revision}, "updatedAt" = now() WHERE id = ${row.id}`;
    await p.$executeRaw`INSERT INTO "EbookSettlementReceipt" (id, "settlementId", payload) VALUES (${receiptId}, ${row.id}, ${JSON.stringify(receipt)}::jsonb)`;
    return true;
  });
}
