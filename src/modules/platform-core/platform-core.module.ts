import { PlatformCorporateController } from './platform-corporate.controller';
import { PlatformMerchantsController } from './platform-merchants.controller';
import { PlatformMerchantsService } from './platform-merchants.service';
import { WebhookModule } from '../../presentation/webhook.module';
import { PlatformWebhookController } from './platform-webhook.controller';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { AuthModule } from '../../presentation/auth.module';
import { CheckoutModule } from '../../presentation/checkout.module';
import { PlatformContextService } from './platform-context.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformOperationsController } from './platform-operations.controller';
import { PlatformSyncService } from './platform-sync.service';
import { PlatformPaymentsService } from '../unified-platform/payments/platform-payments.service';
import { PlatformEventsModule } from './platform-events.module';

@Module({ imports: [WebhookModule, PrismaModule, ApiDomModule, AuthModule, CheckoutModule, PlatformEventsModule],
  controllers: [PlatformCorporateController, PlatformOperationsController, PlatformWebhookController, PlatformMerchantsController], providers: [PlatformContextService, PlatformAuthGuard, PlatformSyncService, PlatformPaymentsService, PlatformMerchantsService],
  exports: [PlatformContextService, PlatformPaymentsService, PlatformSyncService] })
export class PlatformCoreModule {}
