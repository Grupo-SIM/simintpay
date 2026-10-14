import { PlatformReportProjectionsController } from './platform-report-projections.controller';
import { PlatformReportingModule } from '../../application/services/platform-reporting.module';
import { PlatformBetaiController } from './platform-betai.controller';
import { PlatformBetaiService } from './platform-betai.service';
import { PlatformSubscriptionCapabilitiesController } from './platform-subscription-capabilities.controller';
import { PlatformSubscriptionCapabilitiesService } from './platform-subscription-capabilities.service';
import { PlatformVoucherCapabilitiesController } from './platform-voucher-capabilities.controller';
import { PlatformVoucherCapabilitiesService } from './platform-voucher-capabilities.service';
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

@Module({ imports: [PlatformReportingModule, WebhookModule, PrismaModule, ApiDomModule, AuthModule, CheckoutModule, PlatformEventsModule],
  controllers: [PlatformReportProjectionsController, PlatformBetaiController, PlatformSubscriptionCapabilitiesController, PlatformVoucherCapabilitiesController, PlatformCorporateController, PlatformOperationsController, PlatformWebhookController, PlatformMerchantsController], providers: [PlatformBetaiService, PlatformSubscriptionCapabilitiesService, PlatformVoucherCapabilitiesService, PlatformContextService, PlatformAuthGuard, PlatformSyncService, PlatformPaymentsService, PlatformMerchantsService],
  exports: [PlatformBetaiService, PlatformContextService, PlatformPaymentsService, PlatformSyncService] })
export class PlatformCoreModule {}
