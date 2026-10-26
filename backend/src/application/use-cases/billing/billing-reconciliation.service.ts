import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingService } from './billing.service';

@Injectable()
export class BillingReconciliationService {
  private readonly logger = new Logger(BillingReconciliationService.name);
  private running = false;

  constructor(private readonly billing: BillingService) {}

  @Cron('*/30 * * * * *')
  async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.billing.reconcilePendingChanges();
      await this.billing.reconcileDunning();
    } catch (error) {
      this.logger.error(
        `Falha no ciclo de reconciliação de billing: ${String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
