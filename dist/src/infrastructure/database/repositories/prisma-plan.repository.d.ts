import { Plan, PlanType } from '@prisma/client';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import { PrismaService } from '../prisma/prisma.service';
export declare class PrismaPlanRepository implements IPlanRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(data: {
        userId: string;
        name: string;
        description?: string | null;
        price: number;
        type: PlanType;
        isActive?: boolean;
        webhookUrl?: string | null;
        redirectUrl?: string | null;
        domPlanId?: string | null;
    }): Promise<Plan>;
    findManyByUserId(userId: string): Promise<Plan[]>;
    findByIdForUser(input: {
        id: string;
        userId: string;
    }): Promise<Plan | null>;
    delete(id: string): Promise<void>;
}
