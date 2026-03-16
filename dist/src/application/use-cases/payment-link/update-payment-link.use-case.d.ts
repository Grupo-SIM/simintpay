import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { UpdatePaymentLinkDto } from '../../dtos/payment-link/update-payment-link.dto';
export declare class UpdatePaymentLinkUseCase {
    private readonly users;
    private readonly links;
    private readonly gateway;
    constructor(users: IUserRepository, links: IPaymentLinkRepository, gateway: IPaymentGateway);
    execute(input: {
        userId: string;
        id: string;
        dto: UpdatePaymentLinkDto;
    }): Promise<{
        data: unknown;
    }>;
}
