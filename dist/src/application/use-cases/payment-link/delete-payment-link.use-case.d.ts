import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
export declare class DeletePaymentLinkUseCase {
    private readonly users;
    private readonly links;
    private readonly gateway;
    constructor(users: IUserRepository, links: IPaymentLinkRepository, gateway: IPaymentGateway);
    execute(input: {
        userId: string;
        id: string;
    }): Promise<void>;
}
