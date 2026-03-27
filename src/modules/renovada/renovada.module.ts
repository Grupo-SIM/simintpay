import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RenovadaSyncService } from './services/renovada-sync.service';
import { RenovadaWebhookService } from './services/renovada-webhook.service';
import { RenovadaEventsService } from './events/renovada-events.service';
import { RenovadaRealtimeController } from './controllers/renovada-realtime.controller';
import { RenovadaWebhookController } from './controllers/renovada-webhook.controller';
import { PaymentNewService } from './services/payment-new.service';
import { RenovadaPaymentController } from './controllers/renovada-payment.controller';
import { RenovadaWebhookNewController } from './controllers/renovada-webhook-new.controller';
import { WebhookService } from './services/webhook.service';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { RenovadaDashboardService } from './services/renovada-dashboard.service';
import { RenovadaDashboardController } from './controllers/renovada-dashboard.controller';

@Module({
  imports: [ApiDomModule, PrismaModule, HttpModule],
  controllers: [
    RenovadaRealtimeController, 
    RenovadaWebhookController, 
    RenovadaPaymentController, 
    RenovadaWebhookNewController,
    RenovadaDashboardController
  ],
  providers: [
    RenovadaSyncService,
    RenovadaWebhookService,
    RenovadaEventsService,
    PaymentNewService,
    WebhookService,
    RenovadaDashboardService,
  ],
  exports: [
    RenovadaSyncService, 
    RenovadaEventsService, 
    PaymentNewService,
    WebhookService
  ],
})
export class RenovadaModule {}
