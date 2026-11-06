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
import { offerPixPlanCompatEnabled } from './pixplan-compat-flag';
import { PagatgNotifier } from './pagatg-notifier';

/**
 * Crédito de dias das ofertas com `accessDays`. O serviço, o cron e os lembretes sempre rodam.
 * As rotas de compatibilidade do plano PIX (mesmos caminhos do `PixPlanController` legado) só são
 * montadas com `OFFER_PIXPLAN_COMPAT=1`; o `PixPlanModule` legado desmonta as suas na mesma
 * condição, então exatamente um dos dois controllers responde por cada caminho.
 */
@Module({
  imports: [BillingCoreModule, OfferModule],
  controllers: offerPixPlanCompatEnabled()
    ? [
        PixPlanCompatController,
        PublicPixPlanCompatController,
        BotPixPlanCompatController,
      ]
    : [],
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
