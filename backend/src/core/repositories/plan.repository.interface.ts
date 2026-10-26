import type { Plan, PlanType } from '@prisma/client';

export const PLAN_REPOSITORY = Symbol('PLAN_REPOSITORY');

export type CreatePlanData = {
    coproduction?: unknown;
  userId: string;
  name: string;
  description?: string | null;
  price: number;
  type: PlanType;
  frequency?: number | null;
  repetitions?: number | null;
  retryDays?: number | null;
  isActive?: boolean;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
  domPlanId?: string | null;
  code?: string | null;
  paymentMethods?: string | null;
  emailBody?: string | null;
  plataformas?: string[];
};

export interface IPlanRepository {
  create(data: CreatePlanData): Promise<Plan>;
  findManyByUserId(userId: string): Promise<Plan[]>;
  findAll(): Promise<Plan[]>;
  findById(id: string): Promise<Plan | null>;
  findByIdForUser(input: { id: string; userId: string }): Promise<Plan | null>;
  findByCode(code: string): Promise<Plan | null>;
  update(id: string, data: Partial<Omit<CreatePlanData, 'userId'>>): Promise<Plan>;
  delete(id: string): Promise<void>;
}
