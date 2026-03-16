import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { CreatePlanDto } from '../../dtos/plan/create-plan.dto';
export declare class CreatePlanUseCase {
    private readonly users;
    private readonly plans;
    private readonly gateway;
    constructor(users: IUserRepository, plans: IPlanRepository, gateway: IPaymentGateway);
    execute(input: {
        userId: string;
        dto: CreatePlanDto;
    }): Promise<{
        data: unknown;
    }>;
}
