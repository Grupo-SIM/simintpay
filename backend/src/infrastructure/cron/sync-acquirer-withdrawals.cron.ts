import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AcquirerWithdrawalsService } from '../../modules/financial-policy/acquirer-withdrawals.service';

@Injectable()
export class SyncAcquirerWithdrawalsCron {
  private readonly logger = new Logger(SyncAcquirerWithdrawalsCron.name);

  constructor(private readonly withdrawals: AcquirerWithdrawalsService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleSync() {
    if (process.env.DISABLED_DOM_SYNC === 'true') return;
    try {
      const { data } = await this.withdrawals.syncDom();
      if (data.imported)
        this.logger.log(`Saques DOM importados: ${data.imported}`);
    } catch (error) {
      this.logger.warn(
        `Sincronização de saques DOM falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
    }
  }
}
