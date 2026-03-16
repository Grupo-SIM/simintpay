import { Injectable } from '@nestjs/common';
import { Plan, PlanType, Prisma } from '@prisma/client';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaPlanRepository implements IPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    name: string;
    description?: string | null;
    price: number;
    type: PlanType;
    isActive?: boolean;
    webhookUrl?: string | null;
    redirectUrl?: string | null;
    domPlanId?: string | null;
  }): Promise<Plan> {
    return this.prisma.plan.create({
      data: {
        userId: data.userId,
        name: data.name,
        description: data.description ?? undefined,
        price: new Prisma.Decimal(data.price),
        type: data.type,
        isActive: data.isActive ?? true,
        webhookUrl: data.webhookUrl ?? undefined,
        redirectUrl: data.redirectUrl ?? undefined,
        domPlanId: data.domPlanId ?? undefined,
      },
    });
  }

  async findManyByUserId(userId: string): Promise<Plan[]> {
    return this.prisma.plan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdForUser(input: {
    id: string;
    userId: string;
  }): Promise<Plan | null> {
    return this.prisma.plan.findFirst({
      where: { id: input.id, userId: input.userId },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.plan.delete({ where: { id } });
  }
}
