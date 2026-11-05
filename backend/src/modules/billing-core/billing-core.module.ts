import { Module } from '@nestjs/common';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { BUYER_NOTIFIER, LoggingBuyerNotifier } from './buyer-notifier';
import { BillingCycleCron } from './billing-cycle.cron';
import { BillingCycleService } from './billing-cycle.service';
import { ChargeDueDeliveryService } from './charge-due-delivery.service';
import { ExternalRefService } from './external-ref.service';
import { StoredCardCycleExecutor } from './stored-card-cycle.executor';
import { StoredCardVaultService } from './stored-card-vault.service';

@Module({
  imports: [ApiDomModule],
  providers: [
    ExternalRefService,
    BillingCycleService,
    ChargeDueDeliveryService,
    BillingCycleCron,
    StoredCardVaultService,
    StoredCardCycleExecutor,
    { provide: BUYER_NOTIFIER, useClass: LoggingBuyerNotifier },
  ],
  exports: [
    ExternalRefService,
    BillingCycleService,
    ChargeDueDeliveryService,
    StoredCardVaultService,
    StoredCardCycleExecutor,
    BUYER_NOTIFIER,
  ],
})
export class BillingCoreModule {}
