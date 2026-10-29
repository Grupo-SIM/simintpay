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

    // Idempotency pre-check. This `findUnique` alone has a race window (two
    // concurrent deliveries for the same transaction could both observe
    // `already === null`), but that window is closed by the UNIQUE
    // constraint on `AffiliateCommission.transactionId`: the losing
    // concurrent call's `create()` below throws, which aborts the caller's
    // whole outer `$transaction` (the webhook use-case), so that delivery
    // never commits a duplicate credit. The real safety net is the DB
    // constraint, not this check — this check only exists to short-circuit
    // the common (non-racing) case before doing wallet work.
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

    const credited = await this.adjustWalletBalance(p, {
      userId: affiliateUserId,
      delta: commissionAmount,
      action: 'AFFILIATE_COMMISSION_CREDIT',
      transactionId: params.transactionId,
      missingWalletMessage: `[AffiliateCommission] Afiliado ${affiliateUserId} sem wallet — pulando crédito`,
      conflictMessage:
        'Wallet version conflict after 3 retries (affiliate commission)',
    });
    if (!credited) return;

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

    // Claim the reversal *before* touching the wallet, via a conditional
    // `updateMany` guarded on `status: 'CREDITED'`. Under concurrent
    // reversal calls for the same transaction (e.g. overlapping
    // REFUNDED/CHARGEBACK webhook deliveries), only one call's updateMany
    // matches the still-CREDITED row and flips it to REVERSED; the other
    // gets `count === 0` and bails out before ever debiting the wallet.
    // This mirrors the unique-constraint guard `applyForTransaction` gets
    // for free from `create()` — `update()` has no equivalent built-in
    // guard, so we simulate one with the conditional `updateMany`. If the
    // wallet debit below then fails/throws, the caller's outer
    // `$transaction` rolls back and this status flip is undone too, so the
    // claim and the debit stay atomic together.
    const claimed = await p.affiliateCommission.updateMany({
      where: { id: commission.id, status: 'CREDITED' },
      data: { status: 'REVERSED', reversedAt: new Date() },
    });
    if (claimed.count === 0) return;

    await this.adjustWalletBalance(p, {
      userId: commission.affiliateUserId,
      delta: commission.commissionAmount.negated(),
      action: 'AFFILIATE_COMMISSION_REVERSE',
      transactionId,
      missingWalletMessage: `[AffiliateCommission] Afiliado ${commission.affiliateUserId} sem wallet — pulando reversão`,
      conflictMessage:
        'Wallet version conflict after 3 retries (affiliate commission reverse)',
    });
  }

  /**
   * Aplica `delta` (positivo credita, negativo debita) ao saldo da wallet de
   * `userId` com optimistic locking (`version`), registrando o `BalanceLog`
   * correspondente. Faz até 3 tentativas em caso de conflito de versão.
   *
   * Retorna `true` se o ajuste foi aplicado, `false` se a wallet não existe
   * (nesse caso a chamada é ignorada com um log — ver nota em
   * `applyForTransaction`/`reverseForTransaction` sobre essa decisão).
   * Lança erro se esgotar as tentativas por conflito de versão.
   */
  private async adjustWalletBalance(
    p: PrismaTx,
    opts: {
      userId: string;
      delta: Prisma.Decimal;
      action: string;
      transactionId: string;
      missingWalletMessage: string;
      conflictMessage: string;
    },
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wallet = await p.wallet.findUnique({
        where: { userId: opts.userId },
      });
      if (!wallet) {
        // Silent skip + warn, not a thrown error: this runs inside the
        // *referred* user's own transaction-processing flow. Throwing here
        // would abort that legitimate transaction just because the
        // *affiliate* happens to have no wallet — an unrelated-account
        // problem shouldn't block the primary transaction. The trade-off is
        // that the commission is silently lost (no wallet to credit/debit,
        // no AffiliateCommission row written/reverted). Logged at `error`
        // level (not just `warn`) because it represents unrecovered
        // financial data that needs manual follow-up.
        this.logger.error(opts.missingWalletMessage);
        return false;
      }

      const newBalance = wallet.balance.add(opts.delta);

      const result = await p.wallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: { balance: newBalance, version: { increment: 1 } },
      });

      if (result.count > 0) {
        await p.balanceLog.create({
          data: {
            userId: opts.userId,
            action: opts.action,
            transactionId: opts.transactionId,

            balanceDelta: opts.delta,

            lockedDelta: 0,

            source: 'AFFILIATE_COMMISSION',
          },
        });
        return true;
      }

      if (attempt === 2) {
        throw new Error(opts.conflictMessage);
      }
    }

    return false;
  }
}
