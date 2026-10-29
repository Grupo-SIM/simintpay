import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma/prisma.service';
import { findWalletLedgerDivergences } from '../../modules/wallet-ledger/wallet-balance';

/**
 * Read-only daily check: every wallet must end where its BalanceLog ends.
 * A drift means some code path moved money without a ledger row (plan 0007).
 */
@Injectable()
export class WalletConsistencyCron {
  private readonly logger = new Logger(WalletConsistencyCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 6 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleCron() {
    const drifts = await findWalletLedgerDivergences(this.prisma);
    if (!drifts.length) {
      this.logger.log('Carteiras e BalanceLog conciliados.');
      return drifts;
    }
    for (const drift of drifts) {
      this.logger.error(
        `Divergência carteira x ledger: userId=${drift.userId} carteira=${drift.walletBalance} ledger=${drift.ledgerBalance}`,
      );
    }
    return drifts;
  }
}
