import type { Plan, PlanType } from '@prisma/client';

export const PLAN_REPOSITORY = Symbol('PLAN_REPOSITORY');

export type CreatePlanData = {
  userId: string;
  name: string;
  description?: string | null;
  price: number;
  type: PlanType;
  isActive?: boolean;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  domPlanId?: string | null;
};

export interface IPlanRepository {
  create(data: CreatePlanData): Promise<Plan>;
  findManyByUserId(userId: string): Promise<Plan[]>;
  findByIdForUser(input: { id: string; userId: string }): Promise<Plan | null>;
  delete(id: string): Promise<void>;
}
