import type { ILeadRepository } from '../../../core/repositories/lead.repository.interface';
import { CreateLeadDto } from '../../dtos/lead/create-lead.dto';
export declare class CreateLeadUseCase {
    private readonly leads;
    constructor(leads: ILeadRepository);
    execute(dto: CreateLeadDto): Promise<{
        data: {
            id: string;
        };
        message: string;
    }>;
}
