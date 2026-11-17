import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { PixPlanService } from '../application/use-cases/pix-plan/pix-plan.service';
import { PixPlanEventsService } from '../application/services/pix-plan-events.service';
import { PIX_PLAN_REPOSITORY } from '../core/repositories/pix-plan.repository.interface';
import { PrismaPixPlanRepository } from '../infrastructure/database/repositories/prisma-pix-plan.repository';
import { EmailService } from '../infrastructure/email/email.service';

/**
 * No routes: `/payments/pix-plan*` is served by `OfferAccessModule` from offers. Only the legacy
 * `PixPlanService` and its events remain, injected (optionally) by the webhook use cases until
 * they stop crediting plans through it.
 */
@Module({
  imports: [ApiDomModule],
  providers: [
    PixPlanService,
    PixPlanEventsService,
    EmailService,
    { provide: PIX_PLAN_REPOSITORY, useClass: PrismaPixPlanRepository },
  ],
  exports: [PixPlanService, PixPlanEventsService],
})
export class PixPlanModule {}
