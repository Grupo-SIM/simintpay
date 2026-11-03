import { Injectable } from '@nestjs/common';
import { Subscription } from '@prisma/client';
import type { ISubscriptionRepository } from '../../../core/repositories/subscription.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaSubscriptionRepository implements ISubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    planId: string;
    customerId?: string | null;
    status?: string;
    expiresAt?: Date | null;
    totalDaysCredited?: number;
    domSubscriptionId?: string | null;
    financialSnapshot?: import('@prisma/client').Prisma.InputJsonValue;
    tracking?: import('@prisma/client').Prisma.InputJsonValue;
  }): Promise<Subscription> {
    return this.prisma.subscription.create({
      data: {
        userId: data.userId,
        planId: data.planId,
        customerId: data.customerId ?? undefined,
        status: data.status ?? 'active',
        expiresAt: data.expiresAt ?? undefined,
        totalDaysCredited: data.totalDaysCredited ?? 0,
        domSubscriptionId: data.domSubscriptionId ?? undefined,
        financialSnapshot: data.financialSnapshot,
        tracking: data.tracking,
      },
    });
  }

  async findManyByUserId(input: {
    userId: string;
    page: number;
    pageSize: number;
    status?: string;
    planId?: string;
  }): Promise<{ total: number; items: Subscription[] }> {
    const where = {
      userId: input.userId,
      status: input.status ? input.status : undefined,
      planId: input.planId ? input.planId : undefined,
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);

    return { total, items };
  }

  async findByIdForUser(input: {
    id: string;
    userId: string;
  }): Promise<Subscription | null> {
    return this.prisma.subscription.findFirst({
      where: { id: input.id, userId: input.userId },
    });
  }

  async update(
    id: string,
    data: Partial<{
      planId: string;
      customerId?: string | null;
      status?: string;
      expiresAt?: Date | null;
      totalDaysCredited?: number;
      domSubscriptionId?: string | null;
      financialSnapshot?: import('@prisma/client').Prisma.InputJsonValue;
    }>,
  ): Promise<Subscription> {
    return this.prisma.subscription.update({
      where: { id },
      data: {
        planId: data.planId,
        customerId: data.customerId ?? undefined,
        status: data.status,
        expiresAt: data.expiresAt ?? undefined,
        totalDaysCredited: data.totalDaysCredited,
        domSubscriptionId: data.domSubscriptionId ?? undefined,
        financialSnapshot: data.financialSnapshot,
      },
    });
  }
}
