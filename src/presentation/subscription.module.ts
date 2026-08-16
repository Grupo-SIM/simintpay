import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { SubscriptionController } from './controllers/subscription.controller';
import { ListSubscribersUseCase } from '../application/use-cases/subscription/list-subscribers.use-case';
import { CancelSubscriptionUseCase } from '../application/use-cases/subscription/cancel-subscription.use-case';
import { PauseSubscriptionUseCase } from '../application/use-cases/subscription/pause-subscription.use-case';
import { ResumeSubscriptionUseCase } from '../application/use-cases/subscription/resume-subscription.use-case';
import { GetSubscriptionDetailUseCase } from '../application/use-cases/subscription/get-subscription-detail.use-case';
import { SubscriptionWebhookService } from '../application/use-cases/subscription/subscription-webhook.service';
import { BALANCE_LOG_REPOSITORY } from '../core/repositories/balance-log.repository.interface';
import { PrismaBalanceLogRepository } from '../infrastructure/database/repositories/prisma-balance-log.repository';
import { PlatformAccessService } from '../application/services/platform-access.service';
import { BillingModule } from './billing.module';

@Module({
  imports: [ApiDomModule, BillingModule],
  controllers: [SubscriptionController],
  providers: [
    ListSubscribersUseCase,
    CancelSubscriptionUseCase,
    PauseSubscriptionUseCase,
    ResumeSubscriptionUseCase,
    GetSubscriptionDetailUseCase,
    SubscriptionWebhookService,
    PlatformAccessService,
    { provide: BALANCE_LOG_REPOSITORY, useClass: PrismaBalanceLogRepository },
  ],
})
export class SubscriptionModule {}
