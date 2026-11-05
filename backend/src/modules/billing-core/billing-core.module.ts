import { Module } from '@nestjs/common';
import { BUYER_NOTIFIER, LoggingBuyerNotifier } from './buyer-notifier';
import { BillingCycleCron } from './billing-cycle.cron';
import { BillingCycleService } from './billing-cycle.service';
import { ChargeDueDeliveryService } from './charge-due-delivery.service';
import { ExternalRefService } from './external-ref.service';

@Module({
  providers: [
    ExternalRefService,
    BillingCycleService,
    ChargeDueDeliveryService,
    BillingCycleCron,
    { provide: BUYER_NOTIFIER, useClass: LoggingBuyerNotifier },
  ],
  exports: [
    ExternalRefService,
    BillingCycleService,
    ChargeDueDeliveryService,
    BUYER_NOTIFIER,
  ],
})
export class BillingCoreModule {}
