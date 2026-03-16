import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
export declare class ListPlansUseCase {
    private readonly plans;
    constructor(plans: IPlanRepository);
    execute(input: {
        userId: string;
    }): Promise<{
        data: unknown;
    }>;
}
