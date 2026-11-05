import { Module } from '@nestjs/common';
import { BillingCycleService } from './billing-cycle.service';
import { ExternalRefService } from './external-ref.service';

@Module({
  providers: [ExternalRefService, BillingCycleService],
  exports: [ExternalRefService, BillingCycleService],
})
export class BillingCoreModule {}
