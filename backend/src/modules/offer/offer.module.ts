import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from '../../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../../infrastructure/database/repositories/prisma-user.repository';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { BillingCoreModule } from '../billing-core/billing-core.module';
import { OfferCheckoutService } from './offer-checkout.service';
import { OfferController } from './offer.controller';
import { OfferService } from './offer.service';

@Module({
  imports: [ApiDomModule, BillingCoreModule],
  controllers: [OfferController],
  providers: [
    OfferService,
    OfferCheckoutService,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
  exports: [OfferService, OfferCheckoutService],
})
export class OfferModule {}
