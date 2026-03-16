import type { Request } from 'express';
import { CreateLeadDto } from '../../application/dtos/lead/create-lead.dto';
import { CreateLeadUseCase } from '../../application/use-cases/lead/create-lead.use-case';
export declare class LeadController {
    private readonly createLead;
    constructor(createLead: CreateLeadUseCase);
    create(dto: CreateLeadDto, req: Request): Promise<{
        data: {
            id: string;
        };
        message: string;
    }>;
}
