import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { PlanController } from './controllers/plan.controller';
import { CreatePlanUseCase } from '../application/use-cases/plan/create-plan.use-case';
import { ListPlansUseCase } from '../application/use-cases/plan/list-plans.use-case';
import { DeletePlanUseCase } from '../application/use-cases/plan/delete-plan.use-case';
import { PLAN_REPOSITORY } from '../core/repositories/plan.repository.interface';
import { PrismaPlanRepository } from '../infrastructure/database/repositories/prisma-plan.repository';

@Module({
  imports: [ApiDomModule],
  controllers: [PlanController],
  providers: [
    CreatePlanUseCase,
    ListPlansUseCase,
    DeletePlanUseCase,
    { provide: PLAN_REPOSITORY, useClass: PrismaPlanRepository },
  ],
})
export class PlanModule {}
