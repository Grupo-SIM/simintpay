import type { Subscription } from '@prisma/client';
export declare const SUBSCRIPTION_REPOSITORY: unique symbol;
export type CreateSubscriptionData = {
    userId: string;
    planId: string;
    customerId?: string | null;
    status?: string;
    expiresAt?: Date | null;
    totalDaysCredited?: number;
    domSubscriptionId?: string | null;
};
export interface ISubscriptionRepository {
    create(data: CreateSubscriptionData): Promise<Subscription>;
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
    update(id: string, data: Partial<CreateSubscriptionData>): Promise<Subscription>;
}
