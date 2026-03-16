import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { CreateLeadDto } from '../../dtos/lead/create-lead.dto';
export declare class CreateLeadUseCase {
    private readonly gateway;
    constructor(gateway: IPaymentGateway);
    execute(dto: CreateLeadDto): Promise<{
        data: {
            id: string;
        };
        message: string;
    }>;
}
