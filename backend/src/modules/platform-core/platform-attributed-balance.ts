import { allocateNet, snapshotFrom } from '../coproduction/coproduction';
import { platformBalanceRules } from './platform-balance.adapter';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getPlatformTaxaEffective } from '../platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../platform-taxas/platform-taxas.keys';
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

  /**
   * Balance of one merchant account of the platform. The platform context (and its owner check) is unchanged;
   * only the account whose attribution is projected differs.
   */
  async readMerchant(context: PlatformContext, merchantUserId: string) {
    return this.prisma.$transaction(
      (p) => this.readSnapshot(p, context, false, merchantUserId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * History-only reader; callers authorize the session inside the same snapshot.
   * `merchantUserId` projects a seller account instead of the platform owner: the pooled wallet is never the
   * balance (it is shared with the seller's other platforms), affiliate commissions that were only recorded
   * do not count (no wallet credit) and the per-sale service fee already deducted from each credit is applied.
   */
  async readSnapshot(
    p: Prisma.TransactionClient,
    context: PlatformContext,
    allowInactive = false,
    merchantUserId?: string,
  ) {
    const accountUserId = merchantUserId ?? context.ownerUserId;
    const saleFee = merchantUserId
      ? new Prisma.Decimal(
          getPlatformTaxaEffective(
            context.tag,
            'TAXA_SERVICO',
            PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
          ),
        )
      : new Prisma.Decimal(0);
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
      settlementCredits,
      withdrawals,
      wallet,
      productCount,
      unidentifiedOwnerWithdrawals,
    ] = await Promise.all([
      p.transaction.findMany({
        where: { userId: accountUserId, status: 'COMPLETED' },
        select: {
          platformTag: true,
          netAmount: true,
          financialSnapshot: true,
          description: true,
          settlementBasis: true,
        },
      }),
      merchantUserId
        ? p.balanceLog.findMany({
            where: {
              userId: merchantUserId,
              source: { in: ['EBOOK_V1', 'EBOOK_COMMISSION'] },
              platformTag: canonicalTransactionPlatformTag(context.tag),
            },
            select: { balanceDelta: true },
          })
        : Promise.resolve([] as { balanceDelta: Prisma.Decimal }[]),
      p.withdrawRequest.findMany({
        where: {
          userId: accountUserId,
          platform: { in: rules.withdrawalPlatforms, mode: 'insensitive' },
          status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] },
        },
        select: { grossAmount: true, status: true },
      }),
      p.wallet.findUnique({ where: { userId: accountUserId } }),
      p.platform.count({ where: { ownerUserId: context.ownerUserId } }),
      p.withdrawRequest.count({
        where: {
          userId: accountUserId,
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
            (p) => p.userId === accountUserId,
          )?.amount
        : row.netAmount;
      // EBOOK_V1 settlements credit each allocation through BalanceLog (counted below), while the
      // Transaction row belongs to the checkout creator: counting it here would double count or
      // misattribute the whole sale.
      if (merchantUserId && row.settlementBasis === 'EBOOK_V1') continue;
      const recordOnly =
        !!merchantUserId &&
        /\[AFFILIATE_COMMISSION\]/i.test(row.description ?? '');
      if (recordOnly) continue;
      earned = earned.plus(ownerAmount ?? 0).minus(saleFee);
      identifiedTransactions++;
    }
    // Settlement allocations (OWNER/AFFILIATE/COPRODUCER) and credited canonical commissions (EBOOK_COMMISSION) already net of fee and reversals: the sum of
    // balanceDelta is the exact credited amount, exactly once per allocation.
    for (const credit of settlementCredits) {
      earned = earned.plus(credit.balanceDelta);
      if (!credit.balanceDelta.isZero()) identifiedTransactions++;
    }
    for (const row of withdrawals) {
      if (row.status === 'PENDING') reserved = reserved.plus(row.grossAmount);
      else settled = settled.plus(row.grossAmount);
    }
    const singleProductOwner = !merchantUserId && productCount <= 1;
    // Dono de uma única plataforma: a carteira SimIntPay (ledger) é o saldo real; a projeção
    // por transações ignora ajustes de conciliação e legado sem lançamento.
    const balance = singleProductOwner
        ? new Prisma.Decimal(wallet?.balance ?? 0)
        : earned.minus(settled),
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
      ...(merchantUserId ? { accountUserId } : {}),
      earnedCents: cents(earned),
      withdrawnGrossCents: cents(settled),
      pendingWithdrawalsGrossCents: cents(reserved),
      balanceCents: cents(balance),
      availableBalanceCents: cents(Prisma.Decimal.max(0, available)),
      walletScope: merchantUserId
        ? 'merchant-platform'
        : singleProductOwner
          ? 'owner'
          : 'shared-owner',
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
