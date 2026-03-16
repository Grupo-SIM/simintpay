import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { ListSubscribersQueryDto } from '../../dtos/subscription/list-subscribers.query.dto';
export declare class ListSubscribersUseCase {
    private readonly users;
    private readonly gateway;
    constructor(users: IUserRepository, gateway: IPaymentGateway);
    execute(input: {
        userId: string;
        query: ListSubscribersQueryDto;
    }): Promise<{
        data: unknown;
        page: number;
        pageSize: number;
        total: number;
    }>;
}
