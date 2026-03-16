import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
export declare class MonthlyRevenueUseCase {
    private readonly users;
    private readonly gateway;
    constructor(users: IUserRepository, gateway: IPaymentGateway);
    execute(input: {
        userId: string;
    }): Promise<{
        data: unknown;
    }>;
}
