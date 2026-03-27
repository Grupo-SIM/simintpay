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

  /** Todos os planos — usado somente pelo admin (master) */
  async findAll(): Promise<Plan[]> {
    return this.prisma.plan.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Plan | null> {
    return this.prisma.plan.findUnique({ where: { id } });
  }

  async findByIdForUser(input: {
    id: string;
    userId: string;
  }): Promise<Plan | null> {
    return this.prisma.plan.findFirst({
      where: { id: input.id, userId: input.userId },
    });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      description?: string | null;
      price: number;
      type: PlanType;
      isActive?: boolean;
      webhookUrl?: string | null;
      redirectUrl?: string | null;
      domPlanId?: string | null;
    }>,
  ): Promise<Plan> {
    return this.prisma.plan.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description ?? undefined,
        price: data.price != null ? new Prisma.Decimal(data.price) : undefined,
        type: data.type,
        isActive: data.isActive,
        webhookUrl: data.webhookUrl ?? undefined,
        redirectUrl: data.redirectUrl ?? undefined,
        domPlanId: data.domPlanId ?? undefined,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.plan.delete({ where: { id } });
  }
}
