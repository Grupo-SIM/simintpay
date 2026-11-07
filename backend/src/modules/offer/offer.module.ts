import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from '../../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../../infrastructure/database/repositories/prisma-user.repository';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { BillingCoreModule } from '../billing-core/billing-core.module';
import { EmailService } from '../../infrastructure/email/email.service';
import {
  OfferFulfillmentService,
  PrismaFulfillmentMarkers,
} from './offer-fulfillment.service';
import {
  OFFER_SALES_EVENT_OUTBOX,
  PrismaOfferSalesEventOutbox,
} from './offer-sales-event-outbox';
import { OfferCheckoutService } from './offer-checkout.service';
import { OfferRenewalService } from './offer-renewal.service';
import { OfferSubscribeService } from './offer-subscribe.service';
import { OfferController } from './offer.controller';
import {
  PaymentLinksCompatController,
  SubscriptionLinksCompatController,
} from './legacy-links.compat.controller';
import { compatLinkControllers } from './legacy-links.compat';
import { LegacyLinksCompatService } from './legacy-links.compat.service';
import { OfferService } from './offer.service';

@Module({
  imports: [ApiDomModule, BillingCoreModule],
  // OFFER_LEGACY_LINKS_COMPAT=1 swaps the legacy link controllers for these adapters.
  controllers: [
    OfferController,
    ...compatLinkControllers([
      PaymentLinksCompatController,
      SubscriptionLinksCompatController,
    ]),
  ],
  providers: [
    OfferService,
    LegacyLinksCompatService,
    OfferCheckoutService,
    EmailService,
    PrismaFulfillmentMarkers,
    {
      provide: OFFER_SALES_EVENT_OUTBOX,
      useClass: PrismaOfferSalesEventOutbox,
    },
    OfferFulfillmentService,
    OfferSubscribeService,
    OfferRenewalService,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
  exports: [
    OfferService,
    OfferCheckoutService,
    OfferSubscribeService,
    OfferRenewalService,
  ],
})
export class OfferModule {}
