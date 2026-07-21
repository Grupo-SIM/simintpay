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
import { CheckoutModule } from '../../presentation/checkout.module';
import { PlatformDashboardService } from './services/renovada-dashboard.service';
import { PlatformDashboardController } from './controllers/renovada-dashboard.controller';

@Module({
  // CheckoutModule: fornece o CheckoutEventsService (SSE) — o webhook da Renovada
  // emite a confirmação em tempo real para o app (checkout/pix/:paymentId/sse).
  imports: [ApiDomModule, PrismaModule, HttpModule, CheckoutModule],
  controllers: [
    RenovadaRealtimeController,
    RenovadaWebhookController,
    RenovadaPaymentController,
    RenovadaWebhookNewController,
    PlatformDashboardController,
  ],
  providers: [
    RenovadaSyncService,
    RenovadaWebhookService,
    RenovadaEventsService,
    PaymentNewService,
    WebhookService,
    PlatformDashboardService,
  ],
  exports: [
    RenovadaSyncService,
    RenovadaEventsService,
    PaymentNewService,
    WebhookService,
  ],
})
export class RenovadaModule {}
