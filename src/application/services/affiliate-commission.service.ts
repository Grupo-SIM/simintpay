import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class AffiliateCommissionService {
  private readonly logger = new Logger(AffiliateCommissionService.name);

  /**
   * Credita comissão ao afiliado da conta `referredUserId`, se ela tiver
   * `referredByUserId` apontando pra um afiliado ativo (`isAffiliate=true`).
   * Idempotente por `transactionId` (unique em AffiliateCommission).
   */
  async applyForTransaction(
    p: PrismaTx,
    params: {
      transactionId: string;
      referredUserId: string;
      platformFee: Prisma.Decimal | number;
    },
  ): Promise<void> {
    const referred = await p.user.findUnique({
      where: { id: params.referredUserId },
      select: { referredByUserId: true },
    });
    const affiliateUserId = referred?.referredByUserId;
    if (!affiliateUserId) return;

    const affiliate = await p.user.findUnique({
      where: { id: affiliateUserId },
      select: { isAffiliate: true, affiliateCommissionPercent: true },
    });
    if (!affiliate?.isAffiliate || affiliate.affiliateCommissionPercent == null)
      return;

    const already = await p.affiliateCommission.findUnique({
      where: { transactionId: params.transactionId },
    });
    if (already) return;

    const platformFeeDec = new Prisma.Decimal(params.platformFee.toString());
    const percent = new Prisma.Decimal(
      affiliate.affiliateCommissionPercent.toString(),
    );
    const commissionAmount = platformFeeDec.mul(percent).div(100);
    if (commissionAmount.lte(0)) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const wallet = await p.wallet.findUnique({
        where: { userId: affiliateUserId },
      });
      if (!wallet) {
        this.logger.warn(
          `[AffiliateCommission] Afiliado ${affiliateUserId} sem wallet — pulando crédito`,
        );
        return;
      }

      const newBalance = wallet.balance.add(commissionAmount);

      const result = await p.wallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: { balance: newBalance, version: { increment: 1 } },
      });

      if (result.count > 0) {
        await p.balanceLog.create({
          data: {
            userId: affiliateUserId,
            action: 'AFFILIATE_COMMISSION_CREDIT',
            transactionId: params.transactionId,
            amount: commissionAmount,
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            lockedBefore: wallet.lockedBalance,
            lockedAfter: wallet.lockedBalance,
            source: 'AFFILIATE_COMMISSION',
          },
        });
        await p.affiliateCommission.create({
          data: {
            affiliateUserId,
            referredUserId: params.referredUserId,
            transactionId: params.transactionId,
            percentApplied: percent,
            grossPlatformFee: platformFeeDec,
            commissionAmount,
            status: 'CREDITED',
          },
        });
        return;
      }

      if (attempt === 2) {
        throw new Error(
          'Wallet version conflict after 3 retries (affiliate commission)',
        );
      }
    }
  }

  /** Reverte (debita) a comissão CREDITED gerada por `transactionId`, se existir. */
  async reverseForTransaction(
    p: PrismaTx,
    transactionId: string,
  ): Promise<void> {
    const commission = await p.affiliateCommission.findUnique({
      where: { transactionId },
    });
    if (!commission || commission.status !== 'CREDITED') return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const wallet = await p.wallet.findUnique({
        where: { userId: commission.affiliateUserId },
      });
      if (!wallet) {
        this.logger.warn(
          `[AffiliateCommission] Afiliado ${commission.affiliateUserId} sem wallet — pulando reversão`,
        );
        return;
      }

      const newBalance = wallet.balance.sub(commission.commissionAmount);

      const result = await p.wallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: { balance: newBalance, version: { increment: 1 } },
      });

      if (result.count > 0) {
        await p.balanceLog.create({
          data: {
            userId: commission.affiliateUserId,
            action: 'AFFILIATE_COMMISSION_REVERSE',
            transactionId,
            amount: commission.commissionAmount,
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            lockedBefore: wallet.lockedBalance,
            lockedAfter: wallet.lockedBalance,
            source: 'AFFILIATE_COMMISSION',
          },
        });
        await p.affiliateCommission.update({
          where: { id: commission.id },
          data: { status: 'REVERSED', reversedAt: new Date() },
        });
        return;
      }

      if (attempt === 2) {
        throw new Error(
          'Wallet version conflict after 3 retries (affiliate commission reverse)',
        );
      }
    }
  }
}
