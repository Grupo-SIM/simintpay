import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { SubscriptionController } from './controllers/subscription.controller';
import { ListSubscribersUseCase } from '../application/use-cases/subscription/list-subscribers.use-case';
import { CancelSubscriptionUseCase } from '../application/use-cases/subscription/cancel-subscription.use-case';
import { GetSubscriptionDetailUseCase } from '../application/use-cases/subscription/get-subscription-detail.use-case';

@Module({
  imports: [ApiDomModule],
  controllers: [SubscriptionController],
  providers: [
    ListSubscribersUseCase,
    CancelSubscriptionUseCase,
    GetSubscriptionDetailUseCase,
  ],
})
export class SubscriptionModule {}
