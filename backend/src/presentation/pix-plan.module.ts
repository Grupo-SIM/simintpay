import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import {
  PixPlanController,
  PublicPixPlanController,
  BotPixPlanController,
} from './controllers/pix-plan.controller';
import { PixPlanService } from '../application/use-cases/pix-plan/pix-plan.service';
import { PixPlanEventsService } from '../application/services/pix-plan-events.service';
import { PIX_PLAN_REPOSITORY } from '../core/repositories/pix-plan.repository.interface';
import { PrismaPixPlanRepository } from '../infrastructure/database/repositories/prisma-pix-plan.repository';
import { EmailService } from '../infrastructure/email/email.service';
import { offerPixPlanCompatEnabled } from '../modules/offer-access/pixplan-compat-flag';

@Module({
  imports: [ApiDomModule],
  // Com OFFER_PIXPLAN_COMPAT=1 os mesmos caminhos passam a ser servidos pelo OfferAccessModule.
  controllers: offerPixPlanCompatEnabled()
    ? []
    : [PixPlanController, PublicPixPlanController, BotPixPlanController],
  providers: [
    PixPlanService,
    PixPlanEventsService,
    EmailService,
    { provide: PIX_PLAN_REPOSITORY, useClass: PrismaPixPlanRepository },
  ],
  exports: [PixPlanService, PixPlanEventsService],
})
export class PixPlanModule {}
