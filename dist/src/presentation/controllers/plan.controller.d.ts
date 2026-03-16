import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { CreatePlanDto } from '../../application/dtos/plan/create-plan.dto';
import { CreatePlanUseCase } from '../../application/use-cases/plan/create-plan.use-case';
import { ListPlansUseCase } from '../../application/use-cases/plan/list-plans.use-case';
import { DeletePlanUseCase } from '../../application/use-cases/plan/delete-plan.use-case';
export declare class PlanController {
    private readonly list;
    private readonly create;
    private readonly del;
    constructor(list: ListPlansUseCase, create: CreatePlanUseCase, del: DeletePlanUseCase);
    listRoute(user: JwtPayload | undefined): Promise<{
        data: unknown;
    }>;
    createRoute(user: JwtPayload | undefined, dto: CreatePlanDto): Promise<{
        data: unknown;
    }>;
    deleteRoute(user: JwtPayload | undefined, id: string): Promise<{
        deleted: true;
    }>;
}
