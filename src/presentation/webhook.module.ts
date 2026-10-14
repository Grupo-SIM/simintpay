import { Module, forwardRef } from '@nestjs/common';
import { WebhookController } from './controllers/webhook.controller';
import { FrendzWebhookController } from './controllers/frendz-webhook.controller';
import { InternalReconcileController } from './controllers/internal-reconcile.controller';
import { RabbitMqModule } from '../infrastructure/queue/rabbitmq.module';
import { ZeroGrauNotificationConsumer } from '../infrastructure/queue/consumers/zero-grau-notification.consumer';
import { WebhookConsumer } from '../infrastructure/queue/consumers/webhook.consumer';
import { DomWebhookConsumer } from '../infrastructure/queue/consumers/dom-webhook.consumer';
import { ProcessWebhookUseCase } from '../application/use-cases/webhook/process-webhook.use-case';
import { ProcessDomWebhookUseCase } from '../application/use-cases/webhook/process-dom-webhook.use-case';
import { DomPaymentPollingService } from '../application/use-cases/webhook/dom-payment-polling.service';
import { ReconcilePendingTransactionsUseCase } from '../application/use-cases/webhook/reconcile-pending-transactions.use-case';
import { WEBHOOK_EVENT_REPOSITORY } from '../core/repositories/webhook-event.repository.interface';
import { PrismaWebhookEventRepository } from '../infrastructure/database/repositories/prisma-webhook-event.repository';
import { TRANSACTION_REPOSITORY } from '../core/repositories/transaction.repository.interface';
import { PrismaTransactionRepository } from '../infrastructure/database/repositories/prisma-transaction.repository';
import { BALANCE_LOG_REPOSITORY } from '../core/repositories/balance-log.repository.interface';
import { PrismaBalanceLogRepository } from '../infrastructure/database/repositories/prisma-balance-log.repository';
import { CommunityManagementService } from '../application/services/community-management.service';
import { AffiliateCommissionService } from '../application/services/affiliate-commission.service';
import { EmailService } from '../infrastructure/email/email.service';
import { StorageService } from '../infrastructure/storage/storage.service';

import { RenovadaModule } from '../modules/renovada/renovada.module';
import { PixPlanModule } from './pix-plan.module';
import { PixPlanEventsService } from '../application/services/pix-plan-events.service';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { VoucherModule } from './voucher.module';
import { CheckoutModule } from './checkout.module';

@Module({
  imports: [RabbitMqModule, RenovadaModule, VoucherModule, forwardRef(() => PixPlanModule), ApiDomModule, CheckoutModule],
  controllers: [WebhookController, FrendzWebhookController, InternalReconcileController],
  providers: [
    ProcessWebhookUseCase,
    ProcessDomWebhookUseCase,
    ReconcilePendingTransactionsUseCase,
    DomPaymentPollingService,
    WebhookConsumer,
    ZeroGrauNotificationConsumer,
    DomWebhookConsumer,
    CommunityManagementService,
    AffiliateCommissionService,
    EmailService,
    StorageService,
    {
      provide: WEBHOOK_EVENT_REPOSITORY,
      useClass: PrismaWebhookEventRepository,
    },
    { provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository },
    { provide: BALANCE_LOG_REPOSITORY, useClass: PrismaBalanceLogRepository },
  ],
  exports: [ReconcilePendingTransactionsUseCase, ProcessWebhookUseCase],
})
export class WebhookModule {}
