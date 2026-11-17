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
import { OfferAssetsController } from './offer-assets.controller';
import { OfferAssetsService } from './offer-assets.service';
import { OfferController } from './offer.controller';
import {
  PaymentLinksCompatController,
  SubscriptionLinksCompatController,
} from './legacy-links.compat.controller';
import { LegacyLinksCompatService } from './legacy-links.compat.service';
import { OfferService } from './offer.service';
import { OfferSubscribersController } from './offer-subscribers.controller';
import { PagatgNotifier } from '../offer-access/pagatg-notifier';
import { OfferSubscribersService } from './offer-subscribers.service';

@Module({
  imports: [ApiDomModule, BillingCoreModule],
  controllers: [
    OfferSubscribersController,
    OfferController,
    OfferAssetsController,
    PaymentLinksCompatController,
    SubscriptionLinksCompatController,
  ],
  providers: [
    OfferService,
    OfferSubscribersService,
    PagatgNotifier,
    OfferAssetsService,
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
