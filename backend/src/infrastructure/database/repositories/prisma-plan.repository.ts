import { createWithCoproduction } from '../../../modules/coproduction/coproduction.service';
import { Injectable } from '@nestjs/common';
import { Plan, PlanType, Prisma } from '@prisma/client';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaPlanRepository implements IPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    coproduction?: unknown;
    createdByUserId?: string;
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
  }): Promise<Plan> {
    return createWithCoproduction(
      this.prisma,
      'planos',
      data.userId,
      data.coproduction,
      (tx) =>
        tx.plan.create({
          data: {
            userId: data.userId,
            createdByUserId: data.createdByUserId,
            name: data.name,
            description: data.description ?? undefined,
            price: new Prisma.Decimal(data.price),
            type: data.type,
            frequency: data.frequency,
            repetitions: data.repetitions,
            retryDays: data.retryDays,
            isActive: data.isActive ?? true,
            webhookUrl: data.webhookUrl ?? undefined,
            redirectUrl: data.redirectUrl ?? undefined,
            domPlanId: data.domPlanId ?? undefined,
            code: data.code ?? undefined,
            paymentMethods: data.paymentMethods ?? undefined,
            emailBody: data.emailBody ?? undefined,
            plataformas: data.plataformas ?? [],
          },
        }),
    );
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

  async findByCode(code: string): Promise<Plan | null> {
    return this.prisma.plan.findUnique({ where: { code } });
  }

  async update(
    id: string,
    data: Partial<{
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
    }>,
  ): Promise<Plan> {
    return this.prisma.plan.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description ?? undefined,
        price: data.price != null ? new Prisma.Decimal(data.price) : undefined,
        type: data.type,
        frequency: data.frequency,
        repetitions: data.repetitions,
        retryDays: data.retryDays,
        isActive: data.isActive,
        webhookUrl: data.webhookUrl ?? undefined,
        redirectUrl: data.redirectUrl ?? undefined,
        domPlanId: data.domPlanId ?? undefined,
        code: data.code ?? undefined,
        paymentMethods: data.paymentMethods ?? undefined,
        ...(data.emailBody !== undefined && { emailBody: data.emailBody }),
        ...(data.plataformas !== undefined && {
          plataformas: data.plataformas,
        }),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.plan.delete({ where: { id } });
  }
}
