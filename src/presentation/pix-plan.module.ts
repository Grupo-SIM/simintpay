import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import {
  PixPlanController,
  PublicPixPlanController,
  BotPixPlanController,
} from './controllers/pix-plan.controller';
import { PixPlanService } from '../application/use-cases/pix-plan/pix-plan.service';
import { PIX_PLAN_REPOSITORY } from '../core/repositories/pix-plan.repository.interface';
import { PrismaPixPlanRepository } from '../infrastructure/database/repositories/prisma-pix-plan.repository';

@Module({
  imports: [ApiDomModule],
  controllers: [PixPlanController, PublicPixPlanController, BotPixPlanController],
  providers: [
    PixPlanService,
    { provide: PIX_PLAN_REPOSITORY, useClass: PrismaPixPlanRepository },
  ],
  exports: [PixPlanService],
})
export class PixPlanModule {}
