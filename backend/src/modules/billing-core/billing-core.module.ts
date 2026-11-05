import { Module } from '@nestjs/common';
import { ExternalRefService } from './external-ref.service';

@Module({
  providers: [ExternalRefService],
  exports: [ExternalRefService],
})
export class BillingCoreModule {}
