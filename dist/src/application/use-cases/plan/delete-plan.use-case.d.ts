import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
export declare class DeletePlanUseCase {
    private readonly users;
    private readonly plans;
    private readonly gateway;
    constructor(users: IUserRepository, plans: IPlanRepository, gateway: IPaymentGateway);
    execute(input: {
        userId: string;
        id: string;
    }): Promise<void>;
}
