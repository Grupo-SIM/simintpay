import { Module } from '@nestjs/common';
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

@Module({
  imports: [ApiDomModule],
  controllers: [
    RenovadaRealtimeController, 
    RenovadaWebhookController, 
    RenovadaPaymentController, 
    RenovadaWebhookNewController
  ],
  providers: [
    RenovadaSyncService,
    RenovadaWebhookService,
    RenovadaEventsService,
    PaymentNewService,
    WebhookService,
  ],
  exports: [
    RenovadaSyncService, 
    RenovadaEventsService, 
    PaymentNewService,
    WebhookService
  ],
})
export class RenovadaModule {}
