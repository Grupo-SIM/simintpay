import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../core/repositories/subscription-link.repository.interface';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaSubscriptionLinkRepository } from '../infrastructure/database/repositories/prisma-subscription-link.repository';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';
import { legacyLinkControllers } from '../modules/offer/legacy-links.compat';
import { SubscriptionLinkController } from './controllers/subscription-link.controller';
import { SubscriptionLinkEnController } from './controllers/subscription-link-en.controller';
import { CreateSubscriptionLinkUseCase } from '../application/use-cases/subscription-link/create-subscription-link.use-case';
import { ListSubscriptionLinksUseCase } from '../application/use-cases/subscription-link/list-subscription-links.use-case';
import { GetSubscriptionLinkUseCase } from '../application/use-cases/subscription-link/get-subscription-link.use-case';
import { GetPublicSubscriptionLinkUseCase } from '../application/use-cases/subscription-link/get-public-subscription-link.use-case';
import { UpdateSubscriptionLinkUseCase } from '../application/use-cases/subscription-link/update-subscription-link.use-case';
import { DeleteSubscriptionLinkUseCase } from '../application/use-cases/subscription-link/delete-subscription-link.use-case';
import { CheckoutSubscriptionLinkCardUseCase } from '../application/use-cases/subscription-link/checkout-subscription-link-card.use-case';
import { CheckoutSubscriptionLinkPixUseCase } from '../application/use-cases/subscription-link/checkout-subscription-link-pix.use-case';
import { ListSubscriptionLinkOrdersUseCase } from '../application/use-cases/subscription-link/list-subscription-link-orders.use-case';
import { SendSubscriptionLinkAccessEmailUseCase } from '../application/use-cases/subscription-link/send-access-email.use-case';
import { EmailService } from '../infrastructure/email/email.service';
import { VoucherService } from '../application/use-cases/voucher/voucher.service';

@Module({
  imports: [ApiDomModule],
  // OFFER_LEGACY_LINKS_COMPAT=1 replaces the Portuguese controller by the Offer-backed
  // adapter; the English checkout alias keeps working either way.
  controllers: [
    ...legacyLinkControllers([SubscriptionLinkController]),
    SubscriptionLinkEnController,
  ],
  providers: [
    {
      provide: SUBSCRIPTION_LINK_REPOSITORY,
      useClass: PrismaSubscriptionLinkRepository,
    },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    CreateSubscriptionLinkUseCase,
    ListSubscriptionLinksUseCase,
    GetSubscriptionLinkUseCase,
    GetPublicSubscriptionLinkUseCase,
    UpdateSubscriptionLinkUseCase,
    DeleteSubscriptionLinkUseCase,
    CheckoutSubscriptionLinkCardUseCase,
    CheckoutSubscriptionLinkPixUseCase,
    ListSubscriptionLinkOrdersUseCase,
    SendSubscriptionLinkAccessEmailUseCase,
    EmailService,
    VoucherService,
  ],
  exports: [CreateSubscriptionLinkUseCase],
})
export class SubscriptionLinkModule {}
