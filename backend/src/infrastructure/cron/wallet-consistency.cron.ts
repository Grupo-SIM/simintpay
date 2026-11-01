import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma/prisma.service';
import { findWalletLedgerDivergences } from '../../modules/wallet-ledger/wallet-balance';

const SAMPLE_SIZE = 10;

/**
 * Read-only hourly check: every wallet must equal the sum of its BalanceLog.
 * Wallet is driven by the BalanceLog trigger (plan 0019), so any divergence is a real anomaly:
 * tampering or a writer bypassing the ledger. There is no external operator channel in this
 * codebase, so the alert is one structured logger.error line per run (userIds only, never emails).
 * An identical divergent set is not re-alerted on consecutive runs (in memory, per process).
 */
@Injectable()
export class WalletConsistencyCron {
  private readonly logger = new Logger(WalletConsistencyCron.name);
  private running = false;
  private lastAlertedSignature: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 * * * *', { timeZone: 'America/Sao_Paulo' })
  async handleCron() {
    if (this.running) {
      this.logger.warn(
        'Conciliação carteira x ledger anterior ainda em execução; ignorando.',
      );
      return [];
    }
    this.running = true;
    try {
      const drifts = await findWalletLedgerDivergences(this.prisma);
      if (!drifts.length) {
        this.lastAlertedSignature = null;
        this.logger.log('Carteiras e BalanceLog conciliados.');
        return drifts;
      }
      const signature = drifts
        .map(
          (d) =>
            `${d.userId}:${d.balance}:${d.lockedBalance}:${d.ledgerBalance}:${d.ledgerLockedBalance}`,
        )
        .sort()
        .join('|');
      if (signature === this.lastAlertedSignature) {
        this.logger.warn(
          `Divergência carteira x ledger inalterada (${drifts.length} carteira(s)); alerta já emitido.`,
        );
        return drifts;
      }
      this.lastAlertedSignature = signature;
      const sample = drifts.slice(0, SAMPLE_SIZE).map((d) => ({
        userId: d.userId,
        wallet: String(d.balance),
        ledger: String(d.ledgerBalance),
        walletLocked: String(d.lockedBalance),
        ledgerLocked: String(d.ledgerLockedBalance),
      }));
      this.logger.error(
        `ALERTA wallet-ledger-divergence: ${drifts.length} carteira(s) divergem do BalanceLog. ` +
          'Com a Wallet dirigida por trigger isto indica adulteração ou escritor fora do ledger. ' +
          `Amostra (${sample.length}/${drifts.length}): ${JSON.stringify(sample)}`,
      );
      return drifts;
    } catch (error) {
      this.logger.error(
        `Falha na conciliação carteira x ledger: ${String(error)}`,
      );
      return [];
    } finally {
      this.running = false;
    }
  }
}
