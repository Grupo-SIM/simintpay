import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { BillingController } from './controllers/billing.controller';
import { BillingService } from '../application/use-cases/billing/billing.service';
import { BillingReconciliationService } from '../application/use-cases/billing/billing-reconciliation.service';

@Module({
  imports: [ApiDomModule],
  controllers: [BillingController],
  providers: [BillingService, BillingReconciliationService],
  exports: [BillingService],
})
export class BillingModule {}
