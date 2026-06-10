import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { PlanController } from './controllers/plan.controller';
import { CreatePlanUseCase } from '../application/use-cases/plan/create-plan.use-case';
import { ListPlansUseCase } from '../application/use-cases/plan/list-plans.use-case';
import { GetPlanByIdUseCase } from '../application/use-cases/plan/get-plan-by-id.use-case';
import { UpdatePlanUseCase } from '../application/use-cases/plan/update-plan.use-case';
import { DeletePlanUseCase } from '../application/use-cases/plan/delete-plan.use-case';
import { GetPublicPlanUseCase } from '../application/use-cases/plan/get-public-plan.use-case';
import { GetPublicPlanByCodeUseCase } from '../application/use-cases/plan/get-public-plan-by-code.use-case';
import { CreatePublicSubscriptionUseCase } from '../application/use-cases/plan/create-public-subscription.use-case';
import { PLAN_REPOSITORY } from '../core/repositories/plan.repository.interface';
import { SUBSCRIPTION_REPOSITORY } from '../core/repositories/subscription.repository.interface';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaPlanRepository } from '../infrastructure/database/repositories/prisma-plan.repository';
import { PrismaSubscriptionRepository } from '../infrastructure/database/repositories/prisma-subscription.repository';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';
import { EmailService } from '../infrastructure/email/email.service';

@Module({
  imports: [ApiDomModule],
  controllers: [PlanController],
  providers: [
    EmailService,
    CreatePlanUseCase,
    ListPlansUseCase,
    GetPlanByIdUseCase,
    UpdatePlanUseCase,
    DeletePlanUseCase,
    GetPublicPlanUseCase,
    GetPublicPlanByCodeUseCase,
    CreatePublicSubscriptionUseCase,
    { provide: PLAN_REPOSITORY, useClass: PrismaPlanRepository },
    { provide: SUBSCRIPTION_REPOSITORY, useClass: PrismaSubscriptionRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class PlanModule {}
