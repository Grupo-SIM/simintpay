import type { Subscription } from '@prisma/client';

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');

export type CreateSubscriptionData = {
  financialSnapshot?: import('@prisma/client').Prisma.InputJsonValue;
  userId: string;
  planId: string;
  customerId?: string | null;
  status?: string;
  expiresAt?: Date | null;
  totalDaysCredited?: number;
  domSubscriptionId?: string | null;
  tracking?: import('@prisma/client').Prisma.InputJsonValue;
};

export interface ISubscriptionRepository {
  create(data: CreateSubscriptionData): Promise<Subscription>;
  findManyByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
    status?: string;
    planId?: string;
  }): Promise<{ total: number; items: Subscription[] }>;
  findByIdForUser(input: {
    id: string;
    userId: string;
  }): Promise<Subscription | null>;
  update(
    id: string,
    data: Partial<CreateSubscriptionData>,
  ): Promise<Subscription>;
}
