import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { PlatformContext } from './platform-context.service';
import { hasPlatformMarker } from './platform-sync.adapter';

/** Product projection, independent from the owner's pooled cash wallet. No allocation of unidentified history. */
export class PlatformAttributedBalance {
  constructor(private readonly prisma: PrismaService) {}
  async read(context: PlatformContext) {
    return this.prisma.$transaction(async p => {
      const platform = await p.platform.findUnique({ where: { id: context.id }, include: { owner: true } });
      if (!platform?.isActive || !platform.owner.isActive || platform.owner.isPurged || platform.ownerUserId !== context.ownerUserId || platform.tag !== context.tag) throw new ConflictException('Contexto da plataforma mudou');
      const [rows, withdrawals, wallet, productCount, unidentifiedOwnerWithdrawals] = await Promise.all([
        p.transaction.findMany({ where: { userId: context.ownerUserId, status: 'COMPLETED' }, select: { description: true, netAmount: true } }),
        p.withdrawRequest.findMany({ where: { userId: context.ownerUserId, platform: { equals: context.tag, mode: 'insensitive' }, status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] } }, select: { grossAmount: true, status: true } }),
        p.wallet.findUnique({ where: { userId: context.ownerUserId } }),
        p.platform.count({ where: { ownerUserId: context.ownerUserId } }),
        p.withdrawRequest.count({ where: { userId: context.ownerUserId, platform: null, status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] } } }),
      ]);
      let earned = new Prisma.Decimal(0), settled = new Prisma.Decimal(0), reserved = new Prisma.Decimal(0);
      let identifiedTransactions = 0, unidentifiedTransactions = 0, missingNetSnapshots = 0, conflictingOwnerTransactions = 0;
      for (const row of rows) {
        if (!/\[TENANT:[^\]]+\]/i.test(row.description ?? '')) unidentifiedTransactions++;
        const markers = [...(row.description ?? '').matchAll(/\[TENANT:([^\]]+)\]/gi)].map(match => match[1].toUpperCase().replaceAll('_', '-'));
        if (new Set(markers).size > 1) conflictingOwnerTransactions++;
        if (!hasPlatformMarker(row.description, context.tag)) continue;
        if (row.netAmount === null) { missingNetSnapshots++; continue; }
        earned = earned.plus(row.netAmount);
        identifiedTransactions++;
      }
      for (const row of withdrawals) {
        if (row.status === 'PENDING') reserved = reserved.plus(row.grossAmount);
        else settled = settled.plus(row.grossAmount);
      }
      const balance = earned.minus(settled), available = balance.minus(reserved);
      const cents = (value: Prisma.Decimal | number) => {
        const result = new Prisma.Decimal(value).mul(100).toDecimalPlaces(0).toNumber();
        if (!Number.isSafeInteger(result)) throw new ConflictException('Saldo fora do limite');
        return result;
      };
      return {
        unit: 'cents', scope: 'platform-ledger', platformTag: context.tag, ownerUserId: context.ownerUserId,
        earnedCents: cents(earned), withdrawnGrossCents: cents(settled), pendingWithdrawalsGrossCents: cents(reserved),
        balanceCents: cents(balance), availableBalanceCents: cents(Prisma.Decimal.max(0, available)),
        walletScope: productCount > 1 ? 'shared-owner' : 'owner', ownerWalletBalanceCents: cents(wallet?.balance ?? 0),
        identifiedTransactions, unidentifiedOwnerTransactions: unidentifiedTransactions, conflictingOwnerTransactions, unidentifiedOwnerWithdrawals, missingNetSnapshots,
        historicalAttributionComplete: unidentifiedTransactions === 0 && conflictingOwnerTransactions === 0 && unidentifiedOwnerWithdrawals === 0 && missingNetSnapshots === 0,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
