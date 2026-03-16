import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { SubscriptionController } from './controllers/subscription.controller';
import { ListSubscribersUseCase } from '../application/use-cases/subscription/list-subscribers.use-case';
import { CancelSubscriptionUseCase } from '../application/use-cases/subscription/cancel-subscription.use-case';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';

@Module({
  imports: [ApiDomModule],
  controllers: [SubscriptionController],
  providers: [
    ListSubscribersUseCase,
    CancelSubscriptionUseCase,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class SubscriptionModule {}
