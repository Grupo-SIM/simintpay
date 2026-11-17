import { Module } from '@nestjs/common';
import { EmailService } from '../../infrastructure/email/email.service';
import { BillingCoreModule } from '../billing-core/billing-core.module';
import { OfferModule } from '../offer/offer.module';
import { OfferAccessEventsService } from './offer-access-events.service';
import {
  BotPixPlanCompatController,
  PixPlanCompatController,
  PublicPixPlanCompatController,
} from './offer-access.compat.controller';
import { OfferAccessCompatService } from './offer-access.compat.service';
import { OfferAccessCron } from './offer-access.cron';
import { OfferAccessReminderService } from './offer-access-reminder.service';
import { OfferAccessService } from './offer-access.service';
import { PagatgNotifier } from './pagatg-notifier';

/**
 * Crédito de dias das ofertas com renovação. O serviço, o cron e os lembretes rodam sempre, e as
 * rotas de compatibilidade do plano PIX (`/payments/pix-plan*`, `/payments/plan-access`) respondem
 * a partir de ofertas.
 */
@Module({
  imports: [BillingCoreModule, OfferModule],
  controllers: [
    PixPlanCompatController,
    PublicPixPlanCompatController,
    BotPixPlanCompatController,
  ],
  providers: [
    EmailService,
    PagatgNotifier,
    OfferAccessEventsService,
    OfferAccessService,
    OfferAccessReminderService,
    OfferAccessCron,
    OfferAccessCompatService,
  ],
  exports: [OfferAccessService, OfferAccessEventsService],
})
export class OfferAccessModule {}
