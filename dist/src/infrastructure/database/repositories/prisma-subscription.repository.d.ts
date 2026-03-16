import { Subscription } from '@prisma/client';
import type { ISubscriptionRepository } from '../../../core/repositories/subscription.repository.interface';
import { PrismaService } from '../prisma/prisma.service';
export declare class PrismaSubscriptionRepository implements ISubscriptionRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(data: {
        userId: string;
        planId: string;
        customerId?: string | null;
        status?: string;
        expiresAt?: Date | null;
        totalDaysCredited?: number;
        domSubscriptionId?: string | null;
    }): Promise<Subscription>;
    findManyByUserId(input: {
        userId: string;
        page: number;
        pageSize: number;
        status?: string;
        planId?: string;
    }): Promise<{
        total: number;
        items: Subscription[];
    }>;
    findByIdForUser(input: {
        id: string;
        userId: string;
    }): Promise<Subscription | null>;
    update(id: string, data: Partial<{
        planId: string;
        customerId?: string | null;
        status?: string;
        expiresAt?: Date | null;
        totalDaysCredited?: number;
        domSubscriptionId?: string | null;
    }>): Promise<Subscription>;
}
