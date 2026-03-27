import { Module, forwardRef } from '@nestjs/common';
import { WebhookController } from './controllers/webhook.controller';
import { RabbitMqModule } from '../infrastructure/queue/rabbitmq.module';
import { WebhookConsumer } from '../infrastructure/queue/consumers/webhook.consumer';
import { ProcessWebhookUseCase } from '../application/use-cases/webhook/process-webhook.use-case';
import { WEBHOOK_EVENT_REPOSITORY } from '../core/repositories/webhook-event.repository.interface';
import { PrismaWebhookEventRepository } from '../infrastructure/database/repositories/prisma-webhook-event.repository';
import { TRANSACTION_REPOSITORY } from '../core/repositories/transaction.repository.interface';
import { PrismaTransactionRepository } from '../infrastructure/database/repositories/prisma-transaction.repository';
import { BALANCE_LOG_REPOSITORY } from '../core/repositories/balance-log.repository.interface';
import { PrismaBalanceLogRepository } from '../infrastructure/database/repositories/prisma-balance-log.repository';

import { RenovadaModule } from '../modules/renovada/renovada.module';
import { PixPlanModule } from './pix-plan.module';

@Module({
  imports: [RabbitMqModule, RenovadaModule, forwardRef(() => PixPlanModule)],
  controllers: [WebhookController],
  providers: [
    ProcessWebhookUseCase,
    WebhookConsumer,
    {
      provide: WEBHOOK_EVENT_REPOSITORY,
      useClass: PrismaWebhookEventRepository,
    },
    { provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository },
    { provide: BALANCE_LOG_REPOSITORY, useClass: PrismaBalanceLogRepository },
  ],
})
export class WebhookModule {}
