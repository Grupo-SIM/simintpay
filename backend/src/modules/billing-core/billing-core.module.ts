import { Module } from '@nestjs/common';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { BUYER_NOTIFIER, LoggingBuyerNotifier } from './buyer-notifier';
import {
  CARD_TOKEN_SOURCE,
  cardTokenSourceKindFromEnv,
} from './card-token-source';
import {
  CardTokenEndpointSource,
  CustomerTokenSource,
  SubscriptionCardTokenSource,
} from './card-token-sources';
import { BillingCycleCron } from './billing-cycle.cron';
import { BillingCycleService } from './billing-cycle.service';
import { ChargeReconciler } from './charge-reconciler.service';
import {
  CHARGE_STATUS_LOOKUP,
  DomChargeStatusLookup,
} from './charge-status-lookup';
import { ChargeDueDeliveryService } from './charge-due-delivery.service';
import { ExternalRefService } from './external-ref.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { RENEWAL_LINK_BUILDER, SignedRenewalLinkBuilder } from './renewal-link';
import { RenewalReminderCron } from './renewal-reminder.cron';
import { RenewalReminderService } from './renewal-reminder.service';
import { StoredCardCycleExecutor } from './stored-card-cycle.executor';
import { StoredCardVaultService } from './stored-card-vault.service';

@Module({
  imports: [ApiDomModule],
  providers: [
    ExternalRefService,
    BillingCycleService,
    ChargeDueDeliveryService,
    BillingCycleCron,
    EmailService,
    RenewalReminderService,
    RenewalReminderCron,
    { provide: RENEWAL_LINK_BUILDER, useClass: SignedRenewalLinkBuilder },
    StoredCardVaultService,
    StoredCardCycleExecutor,
    ChargeReconciler,
    { provide: CHARGE_STATUS_LOOKUP, useClass: DomChargeStatusLookup },
    { provide: BUYER_NOTIFIER, useClass: LoggingBuyerNotifier },
    {
      // OFFER_CARD_TOKEN_SOURCE=customer-token (default) | subscription | card-token
      provide: CARD_TOKEN_SOURCE,
      inject: [ExternalRefService],
      useFactory: (refs: ExternalRefService) => {
        const kind = cardTokenSourceKindFromEnv();
        if (kind === 'card-token') return new CardTokenEndpointSource();
        if (kind === 'subscription')
          return new SubscriptionCardTokenSource(refs);
        return new CustomerTokenSource();
      },
    },
  ],
  exports: [
    ExternalRefService,
    BillingCycleService,
    ChargeDueDeliveryService,
    StoredCardVaultService,
    StoredCardCycleExecutor,
    ChargeReconciler,
    BUYER_NOTIFIER,
    CARD_TOKEN_SOURCE,
  ],
})
export class BillingCoreModule {}
