import { EbookReceiptOutboxService } from './ebook-receipt-outbox.service';
import { CanonicalCardsController } from './canonical-cards.controller';
import { CanonicalCardsService } from './canonical-cards.service';
import { ReportSessionGuard } from './report-session.guard';
import { PlatformLinksController } from './platform-links.controller';
import { PlatformSalesEventsController } from './platform-sales-events.controller';
import { PlatformSalesEventsService } from './platform-sales-events.service';
import { PaymentLinkModule } from '../../presentation/payment-link.module';
import { PlatformReportProjectionsController } from './platform-report-projections.controller';
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
import { PaymentAttemptsService } from '../unified-platform/payments/payment-attempts.service';
import { PlatformEventsModule } from './platform-events.module';

@Module({
  imports: [
    PaymentLinkModule,
    WebhookModule,
    PrismaModule,
    ApiDomModule,
    AuthModule,
    CheckoutModule,
    PlatformEventsModule,
  ],
  controllers: [
    CanonicalCardsController,
    PlatformLinksController,
    PlatformSalesEventsController,
    PlatformReportProjectionsController,
    PlatformSubscriptionCapabilitiesController,
    PlatformVoucherCapabilitiesController,
    PlatformCorporateController,
    PlatformOperationsController,
    PlatformWebhookController,
    PlatformMerchantsController,
  ],
  providers: [
    EbookReceiptOutboxService,
    CanonicalCardsService,
    ReportSessionGuard,
    PlatformSalesEventsService,
    PlatformSubscriptionCapabilitiesService,
    PlatformVoucherCapabilitiesService,
    PlatformContextService,
    PlatformAuthGuard,
    PlatformSyncService,
    PaymentAttemptsService,
    PlatformPaymentsService,
    PlatformMerchantsService,
  ],
  exports: [
    PlatformContextService,
    PlatformPaymentsService,
    PlatformSyncService,
  ],
})
export class PlatformCoreModule {}
