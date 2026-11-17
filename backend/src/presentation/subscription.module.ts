import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { SubscriptionController } from './controllers/subscription.controller';
import { SubscriptionWebhookService } from '../application/use-cases/subscription/subscription-webhook.service';
import { BALANCE_LOG_REPOSITORY } from '../core/repositories/balance-log.repository.interface';
import { PrismaBalanceLogRepository } from '../infrastructure/database/repositories/prisma-balance-log.repository';
import { BillingModule } from './billing.module';
import { AuthModule } from './auth.module';

@Module({
  imports: [ApiDomModule, AuthModule, BillingModule],
  controllers: [SubscriptionController],
  providers: [
    SubscriptionWebhookService,
    { provide: BALANCE_LOG_REPOSITORY, useClass: PrismaBalanceLogRepository },
  ],
})
export class SubscriptionModule {}
