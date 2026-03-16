import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { CreatePaymentLinkDto } from '../../dtos/payment-link/create-payment-link.dto';
export declare class CreatePaymentLinkUseCase {
    private readonly users;
    private readonly links;
    private readonly gateway;
    constructor(users: IUserRepository, links: IPaymentLinkRepository, gateway: IPaymentGateway);
    execute(input: {
        userId: string;
        dto: CreatePaymentLinkDto;
    }): Promise<{
        data: {
            id: string;
            codigo: string;
            titulo: string;
            descricao: string | null;
            valor: number;
            parcelasMax: number;
            ativo: boolean;
            criadoEm: string;
        };
    }>;
}
