import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BosqueEventsService } from './events/bosque-events.service';
import { BosquePaymentService } from './services/bosque-payment.service';
import { BosqueSyncService } from './services/bosque-sync.service';
import { BosqueWebhookService } from './services/bosque-webhook.service';
import { BosquePaymentController } from './controllers/bosque-payment.controller';
import { BosqueWebhookController } from './controllers/bosque-webhook.controller';
import { BosqueRealtimeController } from './controllers/bosque-realtime.controller';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { CheckoutModule } from '../../presentation/checkout.module';
@Module({
  // CheckoutModule: CheckoutEventsService (SSE) — o webhook do Bosque emite a
  // confirmação em tempo real para o app (checkout/pix/:paymentId/sse).
  imports: [PrismaModule, HttpModule, CheckoutModule],
  controllers: [
    BosquePaymentController,
    BosqueWebhookController,
    BosqueRealtimeController,
  ],
  providers: [
    BosqueEventsService,
    BosquePaymentService,
    BosqueSyncService,
    BosqueWebhookService,
  ],
  exports: [BosqueEventsService, BosquePaymentService, BosqueSyncService],
})
export class BosqueModule {}
