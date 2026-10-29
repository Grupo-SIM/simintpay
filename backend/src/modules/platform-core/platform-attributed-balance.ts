import { allocateNet, snapshotFrom } from '../coproduction/coproduction';
import { platformBalanceRules } from './platform-balance.adapter';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { PlatformContext } from './platform-context.service';
import {
  canonicalTransactionPlatformTag,
  transactionPlatformTag,
} from './transaction-platform';

/** Product projection, independent from the owner's pooled cash wallet. No allocation of unidentified history. */
export class PlatformAttributedBalance {
  constructor(private readonly prisma: PrismaService) {}
  async read(context: PlatformContext) {
    return this.prisma.$transaction((p) => this.readSnapshot(p, context), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  /** History-only reader; callers authorize the session inside the same snapshot. */
  async readSnapshot(
    p: Prisma.TransactionClient,
    context: PlatformContext,
    allowInactive = false,
  ) {
    const rules = platformBalanceRules(context.tag);
    const platform = await p.platform.findUnique({
      where: { id: context.id },
      include: { owner: true },
    });
    if (
      !platform ||
      (!allowInactive &&
        (!platform.isActive ||
          !platform.owner.isActive ||
          platform.owner.isPurged)) ||
      platform.ownerUserId !== context.ownerUserId ||
      platform.tag !== context.tag
    )
      throw new ConflictException('Contexto da plataforma mudou');
    const [
      rows,
      withdrawals,
      wallet,
      productCount,
      unidentifiedOwnerWithdrawals,
    ] = await Promise.all([
      p.transaction.findMany({
        where: { userId: context.ownerUserId, status: 'COMPLETED' },
        select: { platformTag: true, netAmount: true, financialSnapshot: true },
      }),
      p.withdrawRequest.findMany({
        where: {
          userId: context.ownerUserId,
          platform: { in: rules.withdrawalPlatforms, mode: 'insensitive' },
          status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] },
        },
        select: { grossAmount: true, status: true },
      }),
      p.wallet.findUnique({ where: { userId: context.ownerUserId } }),
      p.platform.count({ where: { ownerUserId: context.ownerUserId } }),
      p.withdrawRequest.count({
        where: {
          userId: context.ownerUserId,
          platform: null,
          status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] },
        },
      }),
    ]);
    let earned = new Prisma.Decimal(0),
      settled = new Prisma.Decimal(0),
      reserved = new Prisma.Decimal(0);
    let identifiedTransactions = 0,
      unidentifiedTransactions = 0,
      missingNetSnapshots = 0;
    const conflictingOwnerTransactions = 0;
    for (const row of rows) {
      // Transaction.platformTag is the only attribution source; there is a single tag per row, so the
      // old "conflicting markers" state cannot exist anymore (kept at 0 for response compatibility).
      const rowTag = transactionPlatformTag(row);
      if (!rowTag) unidentifiedTransactions++;
      if (rowTag !== canonicalTransactionPlatformTag(context.tag)) continue;
      if (row.netAmount === null) {
        missingNetSnapshots++;
        continue;
      }
      const agreement = snapshotFrom(row.financialSnapshot);
      const ownerAmount = agreement
        ? allocateNet(agreement, row.netAmount).find(
            (p) => p.userId === context.ownerUserId,
          )?.amount
        : row.netAmount;
      earned = earned.plus(ownerAmount ?? 0);
      identifiedTransactions++;
    }
    for (const row of withdrawals) {
      if (row.status === 'PENDING') reserved = reserved.plus(row.grossAmount);
      else settled = settled.plus(row.grossAmount);
    }
    const balance = earned.minus(settled),
      available = balance.minus(reserved);
    const cents = (value: Prisma.Decimal | number) => {
      const result = new Prisma.Decimal(value)
        .mul(100)
        .toDecimalPlaces(0)
        .toNumber();
      if (!Number.isSafeInteger(result))
        throw new ConflictException('Saldo fora do limite');
      return result;
    };
    return {
      unit: 'cents',
      scope: 'platform-ledger',
      balanceBasis: rules.basis,
      platformTag: context.tag,
      ownerUserId: context.ownerUserId,
      earnedCents: cents(earned),
      withdrawnGrossCents: cents(settled),
      pendingWithdrawalsGrossCents: cents(reserved),
      balanceCents: cents(balance),
      availableBalanceCents: cents(Prisma.Decimal.max(0, available)),
      walletScope: productCount > 1 ? 'shared-owner' : 'owner',
      ownerWalletBalanceCents: cents(wallet?.balance ?? 0),
      identifiedTransactions,
      unidentifiedOwnerTransactions: unidentifiedTransactions,
      conflictingOwnerTransactions,
      unidentifiedOwnerWithdrawals,
      missingNetSnapshots,
      historicalAttributionComplete:
        unidentifiedTransactions === 0 &&
        conflictingOwnerTransactions === 0 &&
        unidentifiedOwnerWithdrawals === 0 &&
        missingNetSnapshots === 0,
    };
  }
}
