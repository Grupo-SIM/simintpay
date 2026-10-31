import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AcquirerFeesService } from '../../modules/financial-policy/acquirer-fees.service';

@Injectable()
export class SyncAcquirerFeesCron {
  private readonly logger = new Logger(SyncAcquirerFeesCron.name);

  constructor(private readonly fees: AcquirerFeesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleSync() {
    if (process.env.DISABLED_DOM_SYNC === 'true') return;
    try {
      await this.fees.syncDom();
    } catch (error) {
      this.logger.warn(
        `Sincronização de custos DOM falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
    }
  }
}
